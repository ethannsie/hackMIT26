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
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from camera import CameraWorker  # noqa: E402
from light import ScanLight  # noqa: E402

HERE = Path(__file__).resolve().parent
UI_DIR = HERE / "ui"
REPO = HERE.parent

PORT = int(os.environ.get("PANEL_PORT", "8770"))
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
        self._clients: list[queue.Queue] = []

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=64)
        with self._lock:
            self._clients.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._clients:
                self._clients.remove(q)

    def publish(self, event: str, data: dict) -> None:
        payload = (event, data)
        with self._lock:
            clients = list(self._clients)
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

        self.view = "home"                 # home | scan | hand | graphs | system
        # Latest motion snapshot from the app (graphs + scrub position), for
        # the Graphs view. The app only sends these while this view is open.
        self.sim: Optional[dict] = None
        self.app_mode = "unknown"          # problem | sandbox | unknown
        self.hand_switch = "auto"          # auto | on | off
        self.scan_active = False
        self.pending: Optional[bytes] = None
        self.pending_at = 0.0
        self.last_saved: Optional[str] = None
        self.saved_count = 0
        self.shutting_down = False

    # --- derived -----------------------------------------------------------

    def hand_wanted(self) -> bool:
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


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "hackmit-panel"

    def log_message(self, fmt: str, *args) -> None:
        # One line per request would bury the events that matter during a demo.
        if os.environ.get("PANEL_VERBOSE"):
            super().log_message(fmt, *args)

    # --- helpers -----------------------------------------------------------

    def _cors(self) -> None:
        # The main app is a different origin (vite :5173). This service binds
        # localhost only and exposes nothing secret, so a blanket allow is the
        # honest configuration rather than a hole.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

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
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # --- routing -----------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]

        if path in ("/", "/index.html"):
            return self._static("index.html")
        if path in ("/panel.css", "/panel.js"):
            return self._static(path.lstrip("/"))

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
        path = self.path.split("?", 1)[0]
        body = self._body()

        if path == "/api/view":
            view = str(body.get("view", "home"))
            if view not in ("home", "scan", "hand", "graphs", "system"):
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
            state.broadcast()
            return self._json(state.snapshot())

        if path == "/api/scan/capture":
            return self._capture()

        if path == "/api/scan/save":
            return self._save()

        if path == "/api/scan/cancel":
            with state.lock:
                state.pending = None
                state.scan_active = False
                state.view = "home"
            state.broadcast()
            return self._json(state.snapshot())

        if path == "/api/system/shutdown":
            if not ALLOW_SHUTDOWN:
                return self._json({"error": "shutdown disabled (PANEL_ALLOW_SHUTDOWN=0)"}, 403)
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
            state.pending_at = time.time()
            state.scan_active = True
            state.view = "scan"
        state.broadcast("scan:captured", {"recapture": recapture})
        return self._json({"ok": True, "recapture": recapture, "bytes": len(jpeg)})

    def _save(self) -> None:
        """Button 2. Writes the frozen frame and tells everyone where it went."""
        with state.lock:
            pending = state.pending
        if not pending:
            return self._json({"error": "nothing captured yet — press 1 first"}, 409)

        CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
        name = f"scan-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jpg"
        (CAPTURE_DIR / name).write_bytes(pending)

        with state.lock:
            state.pending = None
            state.last_saved = name
            state.saved_count += 1
            state.scan_active = False
            state.view = "home"

        # The main app listens for this and runs it through /api/extract, which
        # is what makes the panel's scan button do physics instead of just
        # writing a file to a disk nobody looks at.
        state.broadcast("scan:saved", {"file": name, "url": f"/captures/{name}"})
        return self._json({"ok": True, "file": name, "url": f"/captures/{name}"})

    def _sse(self, hand_frames: bool) -> None:
        q = hub.subscribe()
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
            while True:
                if hand_frames:
                    # Hand frames are their own cadence: the sim wants them at
                    # camera rate, the panel UI only wants state changes.
                    now = time.monotonic()
                    if now - last_hand >= 1 / 30.0:
                        reading = camera.latest_reading()
                        if reading is not None:
                            self._send_event("hand", reading)
                        last_hand = now
                    timeout = 0.02
                else:
                    timeout = 15.0
                try:
                    event, data = q.get(timeout=timeout)
                    self._send_event(event, data)
                except queue.Empty:
                    if not hand_frames:
                        # Comment line: keeps proxies and sleepy Wi-Fi from
                        # dropping an idle stream.
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            hub.unsubscribe(q)

    def _send_event(self, event: str, data: dict) -> None:
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
            interval = 1.0 / STREAM_FPS
            while True:
                seq = camera.frame_seq()
                if seq == last_seq:
                    time.sleep(0.005)
                    continue
                last_seq = seq
                frame = camera.snapshot(overlay=overlay)
                if frame is None:
                    time.sleep(0.1)
                    continue
                jpeg = encode_jpeg(frame, STREAM_QUALITY)
                if jpeg is None:
                    continue
                self.wfile.write(f"--{boundary}\r\n".encode())
                self.wfile.write(b"Content-Type: image/jpeg\r\n")
                self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                self.wfile.write(jpeg)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
                time.sleep(interval)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            if overlay:
                state.sync_camera()


def main() -> None:
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    camera.start()
    status = camera.status()

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"[panel] http://localhost:{PORT}")
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
        server.server_close()


if __name__ == "__main__":
    main()
