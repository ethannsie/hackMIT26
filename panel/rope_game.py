"""Minigame transport only. The browser owns physics; the panel owns the camera.

Kept separate so changes to the game do not conflict with scanning/graphs.
"""
from __future__ import annotations

import time
import threading

LEVEL_COUNT = 5


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
            if not isinstance(body, dict) or body.get("action") not in ("restart", "cut", "next", "replay", "select"):
                return {"error": "invalid rope action"}, 400
            if state.view != "rope":
                return {"error": "open the rope game first"}, 409
            action = body["action"]
            event = {"action": action}
            status = self.snapshot()
            if action == "select":
                level = body.get("level")
                if type(level) is not int or not 1 <= level <= LEVEL_COUNT:
                    return {"error": "invalid level"}, 400
                if not status["connected"]:
                    return {"error": "main display disconnected"}, 409
                event["level"] = level
            if action == "cut" and "rope" in body:
                rope = body["rope"]
                if type(rope) is not int or not 0 <= rope < 2:
                    return {"error": "invalid rope"}, 400
                event["rope"] = rope
            if action in ("next", "replay"):
                eligible = status.get("level", LEVEL_COUNT) < LEVEL_COUNT if action == "next" else status.get("level") == LEVEL_COUNT
                if not status["connected"] or status.get("outcome") != "won" or not eligible:
                    return {"error": "finish the current level before advancing"}, 409
            state.hub.publish("rope:control", event)
            return {"ok": True}, 200
        if path == "/api/rope/status":
            if not isinstance(body, dict) or body.get("outcome") not in ("playing", "won", "lost"):
                return {"error": "invalid game status"}, 400
            stars, cuts, level = body.get("stars"), body.get("cuts"), body.get("level")
            if type(stars) is not int or not 0 <= stars <= 3 or type(cuts) is not int or not 0 <= cuts <= 2:
                return {"error": "invalid stars or cuts"}, 400
            if type(level) is not int or not 1 <= level <= LEVEL_COUNT or body.get("levelCount") != LEVEL_COUNT:
                return {"error": "invalid level"}, 400
            levels, ropes = body.get("levels"), body.get("ropes")
            if not isinstance(levels, list) or len(levels) != LEVEL_COUNT:
                return {"error": "invalid level catalogue"}, 400
            catalogue = []
            for index, item in enumerate(levels):
                if (not isinstance(item, dict) or type(item.get("id")) is not int or item["id"] != index + 1
                    or not isinstance(item.get("name"), str) or not 1 <= len(item["name"]) <= 40
                    or not isinstance(item.get("hint"), str) or len(item["hint"]) > 120
                    or type(item.get("best")) is not int or not -1 <= item["best"] <= 3):
                    return {"error": "invalid level catalogue"}, 400
                catalogue.append({key: item[key] for key in ("id", "name", "hint", "best")})
            if not isinstance(ropes, list) or len(ropes) != (2 if level == 3 else 1):
                return {"error": "invalid ropes"}, 400
            for index, rope in enumerate(ropes):
                if not isinstance(rope, dict) or type(rope.get("index")) is not int or rope["index"] != index or type(rope.get("cut")) is not bool:
                    return {"error": "invalid ropes"}, 400
            if sum(rope["cut"] for rope in ropes) != cuts:
                return {"error": "cuts do not match ropes"}, 400
            with self.lock:
                self.status = {"outcome": body["outcome"], "stars": stars, "cuts": cuts,
                               "tracked": body.get("tracked") is True, "level": level, "levelCount": LEVEL_COUNT,
                               "levels": catalogue, "ropes": [{"index": r["index"], "cut": r["cut"]} for r in ropes]}
                self.updated = time.monotonic()
            return {"ok": True}, 200
        return None


rope_game = RopeGameLink()
