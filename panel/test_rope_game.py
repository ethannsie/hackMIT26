"""Real HTTP/controller integration; no camera access or shutdown required."""
import json
import os
import threading
import unittest
import urllib.error
import urllib.request

os.environ["PANEL_LIGHT"] = "0"
os.environ["PANEL_ALLOW_SHUTDOWN"] = "0"
import panel_server as ps


class RopeIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ps.ThreadingHTTPServer(("127.0.0.1", 0), ps.Handler)
        cls.server.daemon_threads = True
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=3) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as err:
            return err.code, json.load(err)

    def test_tracking_lifecycle_and_existing_modes(self):
        self.request('/api/mode', {"mode": "problem"})
        self.request('/api/hand/switch', {"switch": "off"})
        code, state = self.request('/api/view', {"view": "rope"})
        self.assertEqual(code, 200)
        self.assertTrue(state['hand_wanted'])
        self.assertEqual(state['hand_switch'], 'off')
        self.assertEqual(state['app_mode'], 'problem')
        _, state = self.request('/api/view', {"view": "home"})
        self.assertFalse(state['hand_wanted'])
        self.request('/api/hand/switch', {"switch": "auto"})
        _, state = self.request('/api/mode', {"mode": "sandbox"})
        self.assertTrue(state['hand_wanted'])
        self.request('/api/view', {"view": "rope"})
        _, state = self.request('/api/view', {"view": "home"})
        self.assertTrue(state['hand_wanted'])

    def test_restart_uses_existing_event_bus(self):
        self.request('/api/view', {"view": "rope"})
        queue = ps.hub.subscribe()
        try:
            self.assertEqual(self.request('/api/rope/control', {"action": "restart"})[0], 200)
            self.assertEqual(queue.get(timeout=1), ('rope:control', {"action": "restart"}))
            self.assertEqual(self.request('/api/rope/control', {"action": "cut"})[0], 200)
            self.assertEqual(queue.get(timeout=1), ('rope:control', {"action": "cut"}))
        finally:
            ps.hub.unsubscribe(queue)
        self.assertEqual(self.request('/api/rope/control', {"action": "unknown"})[0], 400)
        self.request('/api/view', {"view": "home"})
        self.assertEqual(self.request('/api/rope/control', {"action": "restart"})[0], 409)

    def payload(self, level=1, outcome="playing"):
        return {"outcome": outcome, "stars": 0, "cuts": 0, "tracked": True,
                "level": level, "levelCount": 5,
                "levels": [{"id": i, "name": f"Puzzle {i}", "hint": "Cut the rope", "best": -1} for i in range(1, 6)],
                "ropes": [{"index": i, "cut": False} for i in range(2 if level == 3 else 1)]}

    def test_next_requires_connected_win_and_stops_after_five(self):
        self.request('/api/view', {"view": "rope"})
        self.request('/api/rope/status', self.payload())
        self.assertEqual(self.request('/api/rope/control', {"action": "next"})[0], 409)
        queue = ps.hub.subscribe()
        try:
            for level in range(1, 5):
                self.assertEqual(self.request('/api/rope/status', self.payload(level, "won"))[0], 200)
                self.assertEqual(self.request('/api/rope/control', {"action": "next"})[0], 200)
                self.assertEqual(queue.get(timeout=1), ('rope:control', {"action": "next"}))
                self.assertEqual(self.request('/api/rope/control', {"action": "replay"})[0], 409)
        finally:
            ps.hub.unsubscribe(queue)
        with ps.rope_game.lock:
            ps.rope_game.updated -= 10
        self.assertEqual(self.request('/api/rope/control', {"action": "next"})[0], 409)
        self.request('/api/rope/status', self.payload(5, "won"))
        self.assertEqual(self.request('/api/rope/control', {"action": "next"})[0], 409)
        self.assertEqual(self.request('/api/rope/control', {"action": "replay"})[0], 200)

    def test_select_any_level_and_cut_each_rope_over_event_bus(self):
        self.request('/api/view', {"view": "rope"})
        self.request('/api/rope/status', self.payload(3))
        queue = ps.hub.subscribe()
        try:
            for level in range(1, 6):
                event = {"action": "select", "level": level}
                self.assertEqual(self.request('/api/rope/control', event)[0], 200)
                self.assertEqual(queue.get(timeout=1), ('rope:control', event))
            for rope in (0, 1):
                event = {"action": "cut", "rope": rope}
                self.assertEqual(self.request('/api/rope/control', event)[0], 200)
                self.assertEqual(queue.get(timeout=1), ('rope:control', event))
        finally:
            ps.hub.unsubscribe(queue)
        for level in (None, 0, 6, 1.5, True, "3"):
            self.assertEqual(self.request('/api/rope/control', {"action": "select", "level": level})[0], 400)
        for rope in (-1, 2, True, "1"):
            self.assertEqual(self.request('/api/rope/control', {"action": "cut", "rope": rope})[0], 400)
        with ps.rope_game.lock:
            ps.rope_game.updated -= 10
        self.assertEqual(self.request('/api/rope/control', {"action": "select", "level": 1})[0], 409)
        self.request('/api/view', {"view": "home"})
        self.assertEqual(self.request('/api/rope/control', {"action": "select", "level": 1})[0], 409)

    def test_status_catalogue_and_disconnect(self):
        payload = self.payload(3, "won")
        payload['stars'] = 3
        payload['levels'][2]['best'] = 3
        self.assertEqual(self.request('/api/rope/status', payload)[0], 200)
        _, status = self.request('/api/rope/status')
        self.assertTrue(status['connected'])
        self.assertEqual(status['levels'][2]['best'], 3)
        self.assertEqual(len(status['ropes']), 2)
        with ps.rope_game.lock:
            ps.rope_game.updated -= 10
        self.assertFalse(self.request('/api/rope/status')[1]['connected'])
        for field, value in [('stars', 99), ('cuts', 'bad'), ('outcome', 'bad'), ('levels', []), ('ropes', []), ('level', 6)]:
            self.assertEqual(self.request('/api/rope/status', {**payload, field: value})[0], 400)
        self.assertEqual(self.request('/api/rope/status', {**payload, 'cuts': 1})[0], 400)


if __name__ == '__main__':
    unittest.main()
