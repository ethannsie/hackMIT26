#!/usr/bin/env python3
"""Control-panel service for the 7 in. touchscreen on the GX10.

Runs on the demo box and serves three things to a Chromium window parked on the
second display: a camera scan flow, a live MediaPipe hand overlay, and a
shutdown control. The main physics app (vite, :5173) stays on the big screen and
talks to this service only over localhost, so it keeps working unchanged if the
panel is not running.

Why stdlib HTTP and not a framework: the GX10 is ARM64 and every extra wheel is
another thing that can fail to build at 3 a.m. ThreadingHTTPServer does MJPEG
(multipart/x-mixed-replace) and server-sent events perfectly well, and the only
non-stdlib imports in the whole panel are the ones MediaPipe already needs.

  python3 panel/panel_server.py            # http://localhost:8770

Environment:
  PANEL_PORT            8770
  PANEL_BIND            127.0.0.1   the app runs on the same box; 0.0.0.0 opens the
                                    scan, hand and SHUTDOWN endpoints to the whole LAN
  PANEL_CAMERA_INDEX    0
  PANEL_CAMERA_WIDTH    1280
  PANEL_CAMERA_HEIGHT   720
  PANEL_CAMERA_FOURCC   MJPG   raw YUYV caps a USB 2 webcam at ~10 fps at 720p
  PANEL_CAMERA_FPS      30     the C270's maximum
  PANEL_CAMERA_DYNAMIC_FPS  0  1 lets auto-exposure drop the rate to 15 in dim light
  PANEL_SCENE_WIDTH_M   1.6    metres across the camera frame, for sim coords
  PANEL_PINCH_CLOSED    0.2    tip gap / palm width that counts as fully pinched
  PANEL_PINCH_OPEN      0.8    ... and as fully open; grab at 70 % of the way closed
  PANEL_FIST_OPEN       1.35   fingertip/knuckle reach ratio that counts as extended
  PANEL_FIST_CLOSED     0.85   ... and as curled; a fist (push) is 70 % curled
  PANEL_SMOOTH          1      0 disables the One Euro landmark filter
  PANEL_SMOOTH_MIN_CUTOFF 1.0  Hz; lower = steadier at rest, laggier
  PANEL_SMOOTH_BETA     0.01   speed gain; higher = less lag when moving
  PANEL_CAPTURE_DIR     <repo>/captures
  PANEL_MODEL           path to hand_landmarker.task (auto-discovered otherwise)
  PANEL_SHUTDOWN_CMD    override the poweroff command (set to 'echo dry-run' to test)
  PANEL_ALLOW_SHUTDOWN  0 to disable the shutdown endpoint entirely
  PANEL_LIGHT           0 to not drive the camera ring light at all
  PANEL_LIGHT_MQTT      localhost:1883   broker the ESP32 ring light listens to
  PANEL_LIGHT_TOPIC     hackmit/scanlight
"""

from __future__ import annotations

import json
import os
import queue
import shlex
import secrets
import tempfile
import socket
import signal
from urllib.parse import urlsplit
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from camera import CameraWorker  # noqa: E402
from light import ScanLight  # noqa: E402
from rope_game import rope_game  # noqa: E402

HERE = Path(__file__).resolve().parent
UI_DIR = HERE / "ui"
REPO = HERE.parent

PORT = int(os.environ.get("PANEL_PORT", "8770"))
# Loopback by default. Everything that talks to the panel — the app's browser,
# the kiosk page and demo.sh health checks — runs on this box. Host/Origin
# checks and a shutdown session token provide additional protection.
BIND = os.environ.get("PANEL_BIND", "127.0.0.1")
CAPTURE_DIR = Path(os.environ.get("PANEL_CAPTURE_DIR", REPO / "captures"))
ALLOW_SHUTDOWN = os.environ.get("PANEL_ALLOW_SHUTDOWN", "1") != "0"

# JPEG quality for the MJPEG previews. The panel is 1024 px wide; 72 is
# indistinguishable there and keeps the stream light enough that it never
# competes with the vision model for the box's attention.
STREAM_QUALITY = 72
STREAM_FPS = 20.0
# Captures are the input to a vision model reading printed text, so they are
# written at full sensor quality. src/extract/compress.ts does the downscaling.
CAPTURE_QUALITY = 95
# Changes each time this process starts. The kiosk page compares it against
# the one it loaded with and reloads itself on a mismatch, so restarting the
# panel with new UI files never leaves the touchscreen running stale script.
SESSION_TOKEN = secrets.token_urlsafe(32)
MAX_BODY_BYTES = 1_000_000
ALLOWED_ORIGINS = set(os.environ.get("PANEL_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173").split(","))

BOOT_ID = f"{int(time.time())}-{os.getpid()}"


def default_shutdown_cmd() -> str:
    override = os.environ.get("PANEL_SHUTDOWN_CMD")
    if override:
        return override
    if sys.platform == "darwin":
        return "sudo shutdown -h now"
    # DGX OS / Ubuntu. `asus` has passwordless sudo on the demo box.
    return "sudo systemctl poweroff"


class Hub:
    """Fan-out for server-sent events. One queue per connected client."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # queue -> the events it does not want. The hand stream is a 30 Hz
        # landmark feed for the sim; the 240-sample graph snapshots the app
        # posts a few times a second are for the panel UI, not for it.
        self._clients: dict[queue.Queue, frozenset[str]] = {}

    def subscribe(self, skip: frozenset[str] = frozenset()) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=64)
        with self._lock:
            self._clients[q] = skip
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._clients.pop(q, None)

    def publish(self, event: str, data: dict) -> None:
        payload = (event, data)
        with self._lock:
            clients = [q for q, skip in self._clients.items() if event not in skip]
        for q in clients:
            try:
                q.put_nowait(payload)
            except queue.Full:
                # A wedged client must not stall the panel. Drop its backlog;
                # every event carries full state, so it resyncs on the next one.
                try:
                    q.get_nowait()
                    q.put_nowait(payload)
                except queue.Empty:
                    pass


class PanelState:
    """Everything the panel UI and the main app need to agree on.

    The hand overlay follows a three-way switch rather than a boolean. 'auto'
    is the behaviour originally asked for — on in sandbox mode, off otherwise —
    and 'on'/'off' let the operator watch tracking at any time without having
    to change what the main app is doing.
    """

    def __init__(self, camera: CameraWorker, hub: Hub, light: ScanLight) -> None:
        self.camera = camera
        self.hub = hub
        self.light = light
        self.lock = threading.Lock()

        self.view = "home"                 # home | scan | hand | graphs | ask | rope | system
        # The app's Ask box mirrors its phase here so the touchscreen can show
        # LISTENING / THINKING in letters a visitor can read from a step back.
        self.ask: dict = {"phase": "idle"}
        # Latest motion snapshot from the app (graphs + scrub position), for
        # the Graphs view. The app only sends these while this view is open.
        self.sim: Optional[dict] = None
        self.app_mode = "unknown"          # problem | sandbox | unknown
        self.hand_switch = "auto"          # auto | on | off
        self.scan_active = False
        self.pending: Optional[bytes] = None
        self.pending_at = 0.0
        self.pending_id: Optional[str] = None
        self.saving = False
        self.last_saved: Optional[str] = None
        self.saved_count = 0
        self.shutting_down = False

    # --- derived -----------------------------------------------------------

    def hand_wanted(self) -> bool:
        if self.view == "rope":
            return True  # Explicit game selection owns tracking until exit.
        if self.hand_switch == "on":
            return True
        if self.hand_switch == "off":
            return False
        return self.app_mode == "sandbox"

    def sync_camera(self) -> None:
        """Track only when something will look at it: the hand view, or the
        main app in sandbox mode consuming frames over /api/hand/events."""
        self.camera.set_tracking(self.hand_wanted() or self.view == "hand")

    def sync_light(self) -> None:
        """The ring light is on exactly while the panel shows the scan view —
        the operator is framing a page, so light it; anywhere else, don't."""
        self.light.set(self.view == "scan")

    def snapshot(self) -> dict:
        return {
            "service": "hackmit-panel",
            "view": self.view,
            "app_mode": self.app_mode,
            "hand_switch": self.hand_switch,
            "hand_wanted": self.hand_wanted(),
            "scan": {
                "active": self.scan_active,
                "has_pending": self.pending is not None,
                "pending_age_s": round(time.time() - self.pending_at, 1) if self.pending else 0,
                "saved_count": self.saved_count,
                "last_saved": self.last_saved,
            },
            "ask": self.ask,
            "shutdown_allowed": ALLOW_SHUTDOWN,
            "shutting_down": self.shutting_down,
            "boot_id": BOOT_ID,
            "camera": self.camera.status(),
            "light": self.light.status(),
        }

    def broadcast(self, event: str = "state", extra: Optional[dict] = None) -> None:
        self.sync_camera()
        self.sync_light()
        data = self.snapshot()
        if extra:
            data.update(extra)
        self.hub.publish(event, data)


camera = CameraWorker(
    index=int(os.environ.get("PANEL_CAMERA_INDEX", "0")),
    width=int(os.environ.get("PANEL_CAMERA_WIDTH", "1280")),
    height=int(os.environ.get("PANEL_CAMERA_HEIGHT", "720")),
    scene_width_m=float(os.environ.get("PANEL_SCENE_WIDTH_M", "1.6")),
    model_path=os.environ.get("PANEL_MODEL"),
)
hub = Hub()
light = ScanLight()
state = PanelState(camera, hub, light)


def encode_jpeg(frame, quality: int) -> Optional[bytes]:
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return buf.tobytes() if ok else None


def do_shutdown() -> None:
    """Give the UI a beat to paint the goodbye screen, then pull the plug."""
    time.sleep(1.2)
    cmd = default_shutdown_cmd()
    print(f"[panel] shutdown: {cmd}", flush=True)
    try:
        subprocess.Popen(shlex.split(cmd))
    except Exception as exc:  # pragma: no cover
        print(f"[panel] shutdown failed: {exc}", flush=True)


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".png": "image/png",
}


def write_capture(name: str, data: bytes) -> None:
    """Publish only a complete file. A failed write leaves the capture retryable."""
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".scan-", dir=CAPTURE_DIR)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, CAPTURE_DIR / name)  # exclusive, atomic final name
    finally:
        Path(temporary).unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "hackmit-panel"

    def log_message(self, fmt: str, *args) -> None:
        # One line per request would bury the events that matter during a demo.
        if os.environ.get("PANEL_VERBOSE"):
            super().log_message(fmt, *args)

    # --- helpers -----------------------------------------------------------

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(10)

    def _trusted(self) -> bool:
        # Host validation also rejects DNS rebinding to loopback.
        try:
            host = urlsplit("http://" + self.headers.get("Host", ""))
            if host.hostname not in ("localhost", "127.0.0.1", "::1") or host.port != self.server.server_port:
                return False
            origin = self.headers.get("Origin")
            own = {f"http://localhost:{self.server.server_port}", f"http://127.0.0.1:{self.server.server_port}"}
            return not origin or origin in ALLOWED_ORIGINS | own
        except ValueError:
            return False

    def _guard(self) -> bool:
        if self._trusted():
            return True
        self.close_connection = True
        self._json({"error": "untrusted host or origin"}, 403)
        return False

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin and self._trusted():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Panel-Token")

    def _json(self, obj: dict, status: int = 200) -> None:
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, body: bytes, ctype: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("chunked request bodies are unsupported")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("invalid Content-Length") from None
        if not 0 <= length <= MAX_BODY_BYTES:
            raise ValueError("body exceeds 1 MB limit")
        if length and self.headers.get_content_type() != "application/json":
            raise ValueError("Content-Type must be application/json")
        raw = self.rfile.read(length) if length else b"{}"
        if length and len(raw) != length:
            raise ValueError("incomplete body")
        try:
            def invalid_constant(value):
                raise ValueError(f"non-finite JSON number: {value}")
            body = json.loads(raw, parse_constant=invalid_constant)
        except (ValueError, UnicodeError, RecursionError):
            raise ValueError("invalid JSON") from None
        if not isinstance(body, dict):
            raise ValueError("body must be a JSON object")
        return body

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._guard():
            return
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # --- routing -----------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        if not self._guard():
            return
        path = self.path.split("?", 1)[0]

        if path in ("/", "/index.html"):
            return self._static("index.html")
        if path in ("/panel.css", "/panel.js", "/rope.css", "/rope.js"):
            return self._static(path.lstrip("/"))

        if path == "/api/session":
            return self._json({"token": SESSION_TOKEN})

        if path == "/api/rope/status":
            return self._json(rope_game.snapshot())

        if path == "/api/health":
            return self._json({"ok": True, "service": "hackmit-panel", "port": PORT})
        if path == "/api/state":
            return self._json(state.snapshot())
        if path == "/api/events":
            return self._sse(hand_frames=False)
        if path == "/api/hand/events":
            return self._sse(hand_frames=True)
        if path == "/api/hand/latest":
            return self._json({"hand": camera.latest_reading()})

        if path == "/stream/raw.mjpg":
            return self._mjpeg(overlay=False)
        if path == "/stream/hand.mjpg":
            return self._mjpeg(overlay=True)

        if path == "/api/scan/pending.jpg":
            with state.lock:
                pending = state.pending
            if not pending:
                return self._json({"error": "no pending capture"}, 404)
            return self._bytes(pending, "image/jpeg")

        if path == "/api/scan/latest.jpg":
            return self._latest_saved()

        if path.startswith("/captures/"):
            return self._capture_file(path[len("/captures/"):])

        self._json({"error": f"no route for {path}"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        if not self._guard():
            return
        path = self.path.split("?", 1)[0]
        try:
            body = self._body()
        except (ValueError, TimeoutError, socket.timeout) as exc:
            self.close_connection = True
            return self._json({"error": str(exc)}, 400)

        rope_response = rope_game.post(path, body, state)
        if rope_response is not None:
            return self._json(*rope_response)

        if path == "/api/view":
            view = str(body.get("view", "home"))
            if view not in ("home", "scan", "hand", "graphs", "ask", "system", "rope"):
                return self._json({"error": f"unknown view {view}"}, 400)
            with state.lock:
                state.view = view
                if view != "scan":
                    state.scan_active = False
            state.broadcast()
            return self._json(state.snapshot())

        if path == "/api/mode":
            mode = str(body.get("mode", "unknown"))
            if mode not in ("problem", "sandbox", "unknown"):
                return self._json({"error": f"unknown mode {mode}"}, 400)
            with state.lock:
                changed = state.app_mode != mode
                state.app_mode = mode
                # Sandbox is the mode where hands matter, so entering it pulls
                # the panel to the hand view unless the operator has overridden
                # the switch by hand.
                if changed and state.hand_switch == "auto" and mode == "sandbox" and state.view in ("home", "hand"):
                    state.view = "hand"
            state.broadcast()
            return self._json(state.snapshot())

        if path == "/api/hand/switch":
            switch = str(body.get("switch", "auto"))
            if switch not in ("auto", "on", "off"):
                return self._json({"error": f"unknown switch {switch}"}, 400)
            with state.lock:
                state.hand_switch = switch
            state.broadcast()
            return self._json(state.snapshot())

        if path == "/api/sim/snapshot":
            # App -> panel, a few times a second while the Graphs view is up:
            # the tracked body's motion samples and where the scrubber is.
            if not isinstance(body, dict) or not isinstance(body.get("samples"), list):
                return self._json({"error": "body must be {samples: [...], ...}"}, 400)
            with state.lock:
                state.sim = body
            hub.publish("sim", body)
            return self._json({"ok": True})

        if path == "/api/app/generate":
            # Panel tile -> app: ask the GX10 for a fresh problem. An optional
            # problem_type narrows it; the app otherwise uses its selected type.
            cmd = {}
            if isinstance(body.get("problem_type"), str):
                cmd["problem_type"] = body["problem_type"]
            hub.publish("app:generate", cmd)
            return self._json({"ok": True})

        if path == "/api/app/ask":
            # Panel -> app: start, stop, or toggle the recording there (the
            # mic is the webcam's, and the answer belongs on the big screen).
            action = str(body.get("action", "toggle"))
            if action not in ("start", "stop", "toggle"):
                return self._json({"error": f"unknown action {action}"}, 400)
            hub.publish("app:ask", {"action": action})
            return self._json({"ok": True})

        if path == "/api/ask/state":
            # App -> panel: where the Ask box is (idle / listening / transcribing
            # / thinking / answered / error), with the words heard and the
            # answer, so the touchscreen can show the same thing the monitor does.
            phase = str(body.get("phase", "idle"))
            if phase not in ("idle", "listening", "transcribing", "thinking", "answered", "error"):
                return self._json({"error": f"unknown phase {phase}"}, 400)
            with state.lock:
                state.ask = {
                    "phase": phase,
                    "seconds_left": body.get("seconds_left"),
                    "heard": body.get("heard"),
                    "answer": body.get("answer"),
                    "error": body.get("error"),
                }
            hub.publish("ask", state.ask)
            return self._json({"ok": True})

        if path == "/api/sim/control":
            # Panel UI -> app: transport. The app applies it exactly as its own
            # play button and scrub slider would.
            action = str(body.get("action", ""))
            if action not in ("play", "pause", "seek"):
                return self._json({"error": f"unknown action {action}"}, 400)
            cmd: dict = {"action": action}
            if action == "seek":
                try:
                    cmd["index"] = max(0, int(body.get("index", 0)))
                except (TypeError, ValueError):
                    return self._json({"error": "seek needs an integer index"}, 400)
            hub.publish("sim:control", cmd)
            return self._json({"ok": True})

        if path == "/api/scan/start":
            with state.lock:
                state.view = "scan"
                state.scan_active = True
                state.pending = None
                state.pending_id = None
            state.broadcast()
            return self._json(state.snapshot())

        if path == "/api/scan/capture":
            return self._capture()

        if path == "/api/scan/save":
            return self._save()

        if path == "/api/scan/cancel":
            with state.lock:
                state.pending = None
                state.pending_id = None
                state.scan_active = False
                state.view = "home"
            state.broadcast()
            return self._json(state.snapshot())

        if path == "/api/system/shutdown":
            if not ALLOW_SHUTDOWN:
                return self._json({"error": "shutdown disabled (PANEL_ALLOW_SHUTDOWN=0)"}, 403)
            if not secrets.compare_digest(self.headers.get("X-Panel-Token", ""), SESSION_TOKEN):
                return self._json({"error": "refresh the panel before shutting down"}, 403)
            if body.get("confirm") is not True:
                return self._json({"error": "send {\"confirm\": true}"}, 400)
            with state.lock:
                state.shutting_down = True
            state.broadcast("system:shutdown")
            threading.Thread(target=do_shutdown, daemon=True).start()
            return self._json({"ok": True, "command": default_shutdown_cmd()})

        self._json({"error": f"no route for {path}"}, 404)

    # --- handlers ----------------------------------------------------------

    def _static(self, name: str) -> None:
        path = (UI_DIR / name).resolve()
        if not path.is_file() or UI_DIR not in path.parents:
            return self._json({"error": "not found"}, 404)
        ctype = CONTENT_TYPES.get(path.suffix, "application/octet-stream")
        self._bytes(path.read_bytes(), ctype)

    def _capture_file(self, name: str) -> None:
        path = (CAPTURE_DIR / name).resolve()
        if not path.is_file() or CAPTURE_DIR.resolve() not in path.parents:
            return self._json({"error": "not found"}, 404)
        self._bytes(path.read_bytes(), "image/jpeg")

    def _latest_saved(self) -> None:
        with state.lock:
            name = state.last_saved
        if not name:
            return self._json({"error": "nothing saved yet"}, 404)
        self._capture_file(name)

    def _capture(self) -> None:
        """Button 1. Freezes the live frame; pressing it again recaptures."""
        frame = camera.snapshot(overlay=False)
        if frame is None:
            return self._json({"error": "no camera frame available"}, 503)
        jpeg = encode_jpeg(frame, CAPTURE_QUALITY)
        if jpeg is None:
            return self._json({"error": "jpeg encode failed"}, 500)
        with state.lock:
            recapture = state.pending is not None
            state.pending = jpeg
            state.pending_id = secrets.token_hex(12)
            state.pending_at = time.time()
            state.scan_active = True
            state.view = "scan"
        state.broadcast("scan:captured", {"recapture": recapture})
        return self._json({"ok": True, "recapture": recapture, "bytes": len(jpeg)})

    def _save(self) -> None:
        """Button 2. Writes the frozen frame and tells everyone where it went."""
        with state.lock:
            if state.saving:
                return self._json({"error": "save already in progress"}, 409)
            pending, capture_id = state.pending, state.pending_id
            if not pending or not capture_id:
                return self._json({"error": "nothing captured yet — press 1 first"}, 409)
            state.saving = True
        name = f"scan-{datetime.now():%Y%m%d-%H%M%S}-{capture_id}.jpg"
        try:
            write_capture(name, pending)
            with state.lock:
                # A recapture/cancel while writing belongs to a newer intent.
                if state.pending is pending and state.pending_id == capture_id:
                    state.pending = None
                    state.pending_id = None
                    state.scan_active = False
                    state.view = "home"
                state.last_saved = name
                state.saved_count += 1
            state.broadcast("scan:saved", {"file": name, "url": f"/captures/{name}"})
            return self._json({"ok": True, "file": name, "url": f"/captures/{name}"})
        except OSError:
            return self._json({"error": "could not save capture; check disk space and retry"}, 500)
        finally:
            with state.lock:
                state.saving = False

    def _sse(self, hand_frames: bool) -> None:
        q = hub.subscribe(skip=frozenset({"sim"}) if hand_frames else frozenset())
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self._cors()
            self.end_headers()
            self._send_event("state", state.snapshot())
            if not hand_frames and state.sim is not None:
                # A reopened Graphs view gets the last plot at once instead of
                # a blank canvas until the app's next snapshot.
                self._send_event("sim", state.sim)

            last_hand = 0.0
            last_ping = time.monotonic()
            last_reading_stamp = None
            while True:
                if hand_frames:
                    # Hand frames are their own cadence: the sim wants them at
                    # camera rate, the panel UI only wants state changes.
                    now = time.monotonic()
                    if now - last_hand >= 1 / 30.0:
                        reading = camera.latest_reading()
                        stamp = reading.get("t_ms") if reading else None
                        if stamp != last_reading_stamp:
                            self._send_event("hand", reading)
                            last_reading_stamp = stamp
                        last_hand = now
                    if now - last_ping >= 10:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        last_ping = now
                    timeout = 0.02
                else:
                    timeout = 1.0
                try:
                    event, data = q.get(timeout=timeout)
                    self._send_event(event, data)
                except queue.Empty:
                    if not hand_frames:
                        # Camera/light health changes independently of button presses.
                        self._send_event("state", state.snapshot())
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        finally:
            hub.unsubscribe(q)

    def _send_event(self, event: str, data: Optional[dict]) -> None:
        payload = f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()
        self.wfile.write(payload)
        self.wfile.flush()

    def _mjpeg(self, overlay: bool) -> None:
        if overlay:
            # Asking for the overlay stream is itself a reason to track, so the
            # hand view works even before any switch is flipped.
            camera.set_tracking(True)
        boundary = "panelframe"
        try:
            self.send_response(200)
            self.send_header("Content-Type", f"multipart/x-mixed-replace; boundary={boundary}")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self._cors()
            self.end_headers()

            last_seq = -1
            last_sent = 0.0
            interval = 1.0 / STREAM_FPS
            while True:
                seq = camera.frame_seq()
                if seq == last_seq and time.monotonic() - last_sent < 1.0:
                    time.sleep(0.005)
                    continue
                last_seq = seq
                frame = camera.snapshot(overlay=overlay)
                if frame is None:
                    # A still-open MJPEG stream otherwise leaves its last hand
                    # frozen on screen indefinitely after the camera disappears.
                    frame = np.zeros((360, 640, 3), dtype=np.uint8)
                    cv2.putText(frame, "Camera unavailable", (105, 175), cv2.FONT_HERSHEY_SIMPLEX, 1, (200, 200, 200), 2)
                    cv2.putText(frame, "Reconnect the webcam", (125, 210), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (160, 160, 160), 1)
                jpeg = encode_jpeg(frame, STREAM_QUALITY)
                if jpeg is None:
                    continue
                self.wfile.write(f"--{boundary}\r\n".encode())
                self.wfile.write(b"Content-Type: image/jpeg\r\n")
                self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                self.wfile.write(jpeg)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
                last_sent = time.monotonic()
                time.sleep(interval)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        finally:
            if overlay:
                state.sync_camera()


def main() -> None:
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    camera.start()
    state.sync_light()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    status = camera.status()

    server = ThreadingHTTPServer((BIND, PORT), Handler)
    server.daemon_threads = True
    print(f"[panel] http://localhost:{PORT}  (bound to {BIND})")
    print(f"[panel]   captures   {CAPTURE_DIR}")
    print(f"[panel]   mediapipe  {'yes' if status['mediapipe'] else 'NO — ' + status['mediapipe_error'][:60]}")
    print(f"[panel]   model      {status['model'] or 'MISSING — run panel/setup.sh'}")
    print(f"[panel]   shutdown   {default_shutdown_cmd() if ALLOW_SHUTDOWN else 'disabled'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[panel] stopping")
    finally:
        camera.stop()
        light.stop()
        server.server_close()


if __name__ == "__main__":
    main()
