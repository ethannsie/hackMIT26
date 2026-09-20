"""Failure-path regressions. Synthetic frames, fake trackers and a loopback server."""
import http.client
import json
import os
import sys
import importlib.util
from types import SimpleNamespace
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

os.environ.update(PANEL_LIGHT="0", PANEL_ALLOW_SHUTDOWN="1", PANEL_SHUTDOWN_CMD="echo TEST-ONLY")
import numpy as np
import camera as cam
import light
import panel_server as ps


class CameraTests(unittest.TestCase):
    def test_legacy_bridge_supplies_fist_and_suppresses_false_pinch(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        module_spec = importlib.util.spec_from_file_location('legacy_hand', Path(__file__).resolve().parent.parent / 'hand_physics_demo.py')
        legacy = importlib.util.module_from_spec(module_spec)
        sys.modules['legacy_hand'] = legacy
        with patch.dict(sys.modules, {'mediapipe': Mock()}): module_spec.loader.exec_module(legacy)
        hand = legacy.HandInteraction()
        hand.hand_visible, hand.is_pinching = True, True
        points = [SimpleNamespace(x=0.5, y=0.5, z=0) for _ in range(21)]
        for tip, knuckle in cam.FINGERS:
            points[knuckle] = SimpleNamespace(x=0.5, y=0.3, z=0)
            points[tip] = SimpleNamespace(x=0.5, y=0.39, z=0)
        frame = legacy.bridge_frame(hand, 640, 480, points)
        self.assertGreater(frame['fist'], 0.7)
        self.assertEqual(frame['pinch'], 0)

    def test_orientation_and_age(self):
        worker = cam.CameraWorker()
        source = np.zeros((4, 6, 3), dtype=np.uint8)
        source[:, :2] = 255
        cap = Mock()
        def read():
            worker._stop.set()
            return True, source
        cap.read.side_effect = read
        with patch.object(worker, '_open', return_value=cap): worker._run()
        np.testing.assert_array_equal(worker.snapshot(), source)
        np.testing.assert_array_equal(worker.snapshot(True), source[:, ::-1])
        worker._frame_at -= 2
        self.assertIsNone(worker.snapshot())

    def test_stale_reading_and_failure_clear_state(self):
        worker = cam.CameraWorker()
        worker._reading = cam.HandReading(time.monotonic() * 1000, 'right', 1, (0, 0, 0), (1, 0, 0), 1)
        self.assertIsNotNone(worker.latest_reading())
        worker._reading.t_ms -= 500
        self.assertIsNone(worker.latest_reading())
        worker._invalidate('unplugged')
        self.assertIsNone(worker.latest_reading())
        self.assertIsNone(worker.snapshot())
        self.assertFalse(worker.status()['camera_ok'])

    def test_tracker_exception_restarts_worker(self):
        worker = cam.CameraWorker()
        worker._tracking_wanted = True
        worker.model_path = Path('fake-model')
        cap = Mock(); cap.read.return_value = (True, np.zeros((4, 6, 3), dtype=np.uint8))
        tracker = Mock(); attempts = []
        def track(*_):
            attempts.append(1)
            if len(attempts) == 1: raise RuntimeError('temporary tracker failure')
            worker._stop.set()
            return None
        with patch.object(cam, 'HAVE_MEDIAPIPE', True), patch.object(worker, '_open', return_value=cap), patch.object(worker, '_make_tracker', return_value=tracker) as make, patch.object(worker, '_track', side_effect=track):
            worker._run()
        self.assertEqual(make.call_count, 2)
        self.assertTrue(worker.status()['camera_ok'])
        self.assertEqual(worker.status()['error'], '')

    def test_read_failure_invalidates_before_reopen(self):
        worker = cam.CameraWorker(); cap = Mock(); cap.read.return_value = (False, None)
        worker._reading = cam.HandReading(time.monotonic() * 1000, 'right', 1, (0, 0, 0), (1, 0, 0), 1)
        calls = []
        def opened():
            calls.append(1)
            if len(calls) == 2:
                self.assertIsNone(worker.latest_reading()); self.assertFalse(worker.status()['camera_ok']); worker._stop.set()
            return cap
        with patch.object(worker, '_open', side_effect=opened): worker._run()
        self.assertEqual(len(calls), 2)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ps.ThreadingHTTPServer(('127.0.0.1', 0), ps.Handler)
        cls.server.daemon_threads = True
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.temp = tempfile.TemporaryDirectory()
        ps.CAPTURE_DIR = Path(cls.temp.name)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.temp.cleanup()

    def request(self, path, payload=b'{}', headers=None, method='POST'):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        conn.request(method, path, payload, { 'Content-Type': 'application/json', **(headers or {}) })
        res = conn.getresponse(); data = json.loads(res.read()); conn.close()
        return res.status, data

    def test_invalid_body_limits_origins_and_shutdown_token(self):
        for payload in [b'null', b'[]', b'3', b'"x"', b'{bad']:
            self.assertEqual(self.request('/api/mode', payload)[0], 400)
        self.assertEqual(self.request('/api/mode', b'', {'Content-Length': str(ps.MAX_BODY_BYTES + 1)})[0], 400)
        self.assertEqual(self.request('/api/mode', b'', {'Content-Length': '-1'})[0], 400)
        self.assertEqual(self.request('/api/mode', headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/api/mode', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/api/system/shutdown', b'{"confirm":true}')[0], 403)
        with patch.object(ps, 'do_shutdown') as shutdown:
            self.assertEqual(self.request('/api/system/shutdown', b'{"confirm":true}', {'X-Panel-Token': ps.SESSION_TOKEN})[0], 200)
            deadline = time.monotonic() + 1
            while not shutdown.called and time.monotonic() < deadline: time.sleep(0.01)
            shutdown.assert_called_once()
        self.assertEqual(self.request('/api/state', method='GET')[0], 200)

    def test_mjpeg_replaces_stale_preview_after_camera_loss(self):
        ps.camera._frame = np.full((360, 640, 3), 120, dtype=np.uint8)
        ps.camera._frame_at = time.monotonic()
        ps.camera._frame_seq += 1
        ps.camera._camera_ok = True
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        conn.request('GET', '/stream/raw.mjpg')
        res = conn.getresponse()
        def read_frame():
            length = 0
            while True:
                line = res.readline()
                if line.lower().startswith(b'content-length:'): length = int(line.split(b':')[1])
                if length and line == b'\r\n': break
            return res.read(length)
        try:
            first = read_frame()
            ps.camera._invalidate('disconnected')
            second = read_frame()
            self.assertTrue(first.startswith(b'\xff\xd8') and second.startswith(b'\xff\xd8'))
            self.assertNotEqual(first, second)
            self.assertFalse(ps.camera.status()['camera_ok'])
        finally: conn.close()

    def test_concurrent_save_and_recapture_preserves_new_pending(self):
        entered, release = threading.Event(), threading.Event()
        original = ps.write_capture
        def write(name, data): entered.set(); release.wait(2); original(name, data)
        with ps.state.lock:
            ps.state.pending, ps.state.pending_id = b'old jpeg', 'first'
            before = ps.state.saved_count
        results = []
        with patch.object(ps, 'write_capture', side_effect=write):
            thread = threading.Thread(target=lambda: results.append(self.request('/api/scan/save')))
            thread.start(); self.assertTrue(entered.wait(1))
            self.assertEqual(self.request('/api/scan/save')[0], 409)
            with ps.state.lock: ps.state.pending, ps.state.pending_id = b'new jpeg', 'second'
            release.set(); thread.join(3)
        self.assertEqual(results[0][0], 200)
        self.assertEqual(ps.state.saved_count, before + 1)
        self.assertEqual(ps.state.pending, b'new jpeg')
        self.assertEqual(self.request('/api/scan/save')[0], 200)
        self.assertEqual(ps.state.saved_count, before + 2)
        self.assertEqual(len(list(ps.CAPTURE_DIR.glob('*.jpg'))), 2)

    def test_failed_save_is_retryable_and_leaves_no_partial_file(self):
        with ps.state.lock: ps.state.pending, ps.state.pending_id = b'retry jpeg', 'retry'
        with patch.object(ps.os, 'fsync', side_effect=OSError('disk full')):
            self.assertEqual(self.request('/api/scan/save')[0], 500)
        self.assertEqual(ps.state.pending, b'retry jpeg')
        self.assertFalse(list(ps.CAPTURE_DIR.glob('.scan-*')))
        self.assertEqual(self.request('/api/scan/save')[0], 200)


class LightTests(unittest.TestCase):
    def test_retries_refreshes_and_turns_off_on_stop(self):
        calls = []
        def publish(*args, **_):
            calls.append(args[3])
            if len(calls) == 1: raise ConnectionError('broker down')
        with patch.object(light, 'publish_once', side_effect=publish):
            lamp = light.ScanLight(enabled=True, retry_s=0.01, refresh_s=0.03)
            try:
                lamp.set(True)
                deadline = time.monotonic() + 1
                while len(calls) < 3 and time.monotonic() < deadline: time.sleep(0.01)
                self.assertGreaterEqual(len(calls), 3)
                self.assertEqual(lamp.published, True)
                self.assertEqual(lamp.error, '')
            finally: lamp.stop()
        self.assertEqual(calls[-1], 'off')


if __name__ == '__main__': unittest.main()
