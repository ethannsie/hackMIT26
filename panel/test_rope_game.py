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

    def test_status_and_disconnect(self):
        payload = {"outcome": "won", "stars": 3, "cuts": 1, "tracked": True}
        self.assertEqual(self.request('/api/rope/status', payload)[0], 200)
        _, status = self.request('/api/rope/status')
        self.assertTrue(status['connected'])
        self.assertEqual(status['stars'], 3)
        with ps.rope_game.lock:
            ps.rope_game.updated -= 10
        self.assertFalse(self.request('/api/rope/status')[1]['connected'])
        self.assertEqual(self.request('/api/rope/status', {**payload, 'stars': 99})[0], 400)
        self.assertEqual(self.request('/api/rope/status', {**payload, 'cuts': 'bad'})[0], 400)
        self.assertEqual(self.request('/api/rope/status', {**payload, 'outcome': 'bad'})[0], 400)


if __name__ == '__main__':
    unittest.main()
