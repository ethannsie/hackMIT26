#!/usr/bin/env python3
"""End-to-end check of the panel service, with no camera and no MediaPipe.

Runs the real server against a synthetic frame, so it proves the scan state
machine, the mode/switch logic, the SSE fan-out and the shutdown guard without
needing the hardware. That matters because the hardware is the part most
likely to be missing when someone touches this code.

  python3 panel/test_panel.py

Never powers anything off: the shutdown command is overridden with echo.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("PANEL_TEST_PORT", "8791"))
BASE = f"http://127.0.0.1:{PORT}"
TMP = Path(tempfile.mkdtemp(prefix="panel-test-"))

os.environ.update(
    PANEL_PORT=str(PORT),
    PANEL_CAMERA_INDEX="99",  # deliberately absent: the worker must cope
    PANEL_CAPTURE_DIR=str(TMP / "captures"),
    PANEL_SHUTDOWN_CMD="echo DRY-RUN-POWEROFF",
)

sys.path.insert(0, str(HERE))
import numpy as np  # noqa: E402
import panel_server as ps  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def req(path: str, body: dict | None = None, raw: bool = False):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"content-type": "application/json"} if data else {}
    request = urllib.request.Request(BASE + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=5) as resp:
            payload = resp.read()
            return resp.status, (payload if raw else json.loads(payload))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def main() -> int:
    # The capture loop never succeeds on index 99, so an injected frame stays
    # put and stands in for a webcam.
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    frame[:, :, 1] = 90
    ps.camera._frame = frame
    ps.camera._frame_seq = 1
    ps.camera._camera_ok = True

    server = ps.ThreadingHTTPServer(("127.0.0.1", PORT), ps.Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    time.sleep(0.4)

    print("\n[scan flow]")
    _, d = req("/api/scan/start", {})
    check("start enters scan view", d["view"] == "scan" and d["scan"]["active"], d)

    s, d = req("/api/scan/capture", {})
    check("capture (button 1) succeeds", s == 200 and d["ok"] and not d["recapture"], d)

    _, d = req("/api/state")
    check("state shows pending", d["scan"]["has_pending"], d["scan"])

    s, img = req("/api/scan/pending.jpg", raw=True)
    check("pending.jpg served", s == 200 and img[:2] == b"\xff\xd8", s)

    _, d = req("/api/scan/capture", {})
    check("recapture flagged as such", d["recapture"] is True, d)

    s, d = req("/api/scan/save", {})
    check("save (button 2) writes a file", s == 200 and d["ok"], d)
    saved = Path(os.environ["PANEL_CAPTURE_DIR"]) / d["file"]
    check("file exists on disk", saved.is_file() and saved.stat().st_size > 500, saved)

    _, d = req("/api/state")
    check("pending cleared, count incremented",
          not d["scan"]["has_pending"] and d["scan"]["saved_count"] == 1, d["scan"])
    check("returns to home after save", d["view"] == "home", d["view"])

    s, img = req("/api/scan/latest.jpg", raw=True)
    check("latest.jpg serves the saved scan", s == 200 and img[:2] == b"\xff\xd8", s)

    s, _ = req("/api/scan/save", {})
    check("double-save is rejected", s == 409, s)

    print("\n[mode + hand switch]")
    _, d = req("/api/mode", {"mode": "sandbox"})
    check("sandbox turns hand tracking on", d["hand_wanted"] and d["app_mode"] == "sandbox", d)
    check("sandbox pulls the panel to the hand view", d["view"] == "hand", d["view"])

    _, d = req("/api/mode", {"mode": "problem"})
    check("problem turns it back off", not d["hand_wanted"], d)

    _, d = req("/api/hand/switch", {"switch": "on"})
    check("'always on' overrides problem mode", d["hand_wanted"], d)

    req("/api/mode", {"mode": "sandbox"})
    _, d = req("/api/hand/switch", {"switch": "off"})
    check("'off' overrides sandbox", not d["hand_wanted"], d)

    s, _ = req("/api/hand/switch", {"switch": "bogus"})
    check("bad switch rejected", s == 400, s)
    s, _ = req("/api/mode", {"mode": "bogus"})
    check("bad mode rejected", s == 400, s)

    print("\n[guards]")
    s, _ = req("/captures/../panel/panel_server.py", raw=True)
    check("path traversal on /captures blocked", s == 404, s)

    print("\n[sse]")
    seen: dict[str, bool] = {}

    def read_sse() -> None:
        with urllib.request.urlopen(BASE + "/api/events", timeout=6) as r:
            buf = ""
            for _ in range(40):
                buf += r.readline().decode()
                if "scan:captured" in buf and buf.endswith("\n\n"):
                    seen["captured"] = True
                    return

    thread = threading.Thread(target=read_sse, daemon=True)
    thread.start()
    time.sleep(0.6)
    req("/api/scan/capture", {})
    thread.join(timeout=4)
    check("SSE delivers scan:captured", seen.get("captured") is True)

    print("\n[mjpeg]")
    with urllib.request.urlopen(BASE + "/stream/raw.mjpg", timeout=5) as r:
        head = r.read(600)
    check("mjpeg multipart header", b"--panelframe" in head and b"image/jpeg" in head, head[:60])

    print("\n[shutdown]")
    s, _ = req("/api/system/shutdown", {})
    check("shutdown needs confirm", s == 400, s)
    s, d = req("/api/system/shutdown", {"confirm": True})
    check("confirmed shutdown accepted (dry run)", s == 200 and "echo" in d["command"], d)

    print("\n" + ("ALL PASS" if not failures else f"{len(failures)} FAILED: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
