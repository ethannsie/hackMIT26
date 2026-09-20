"""Minigame transport only. The browser owns physics; the panel owns the camera.

Kept separate so changes to the game do not conflict with scanning/graphs.
"""
from __future__ import annotations

import time
import threading


class RopeGameLink:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.status: dict = {}
        self.updated = 0.0

    def snapshot(self) -> dict:
        with self.lock:
            return {**self.status, "connected": time.monotonic() - self.updated < 4}

    def post(self, path: str, body: dict, state):
        if path == "/api/rope/control":
            if not isinstance(body, dict) or body.get("action") not in ("restart", "cut", "next", "replay"):
                return {"error": "expected restart, cut, next or replay action"}, 400
            if state.view != "rope":
                return {"error": "open the rope game first"}, 409
            if body["action"] in ("next", "replay"):
                status = self.snapshot()
                if not status["connected"] or status.get("outcome") != "won" or status.get("level") != (1 if body["action"] == "next" else 2):
                    return {"error": "finish the current level before advancing"}, 409
            state.hub.publish("rope:control", {"action": body["action"]})
            return {"ok": True}, 200
        if path == "/api/rope/status":
            if not isinstance(body, dict) or body.get("outcome") not in ("playing", "won", "lost"):
                return {"error": "invalid game status"}, 400
            stars = body.get("stars")
            cuts = body.get("cuts")
            if type(stars) is not int or not 0 <= stars <= 3 or type(cuts) is not int or not 0 <= cuts <= 20:
                return {"error": "invalid stars or cuts"}, 400
            level = body.get("level")
            if type(level) is not int or level not in (1, 2) or body.get("levelCount") != 2:
                return {"error": "invalid level"}, 400
            with self.lock:
                self.status = {"outcome": body["outcome"], "stars": stars, "cuts": cuts,
                               "tracked": body.get("tracked") is True, "level": level, "levelCount": 2}
                self.updated = time.monotonic()
            return {"ok": True}, 200
        return None


rope_game = RopeGameLink()
