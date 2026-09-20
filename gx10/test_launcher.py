import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import health
import process_owner


class LaunchTests(unittest.TestCase):
    def test_health_requires_identity_and_success(self):
        for path, payload in [('/api/health', {'ok': True}), ('/api/ready', {'service': 'hackmit-api', 'ok': False}), ('/api/state', {'view': 'home'})]:
            with patch.object(health.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(payload).encode())):
                self.assertFalse(health.healthy(1, path))
        with patch.object(health.urllib.request, 'urlopen', side_effect=OSError('500')):
            self.assertFalse(health.healthy(1, '/api/health'))
        with patch.object(health.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"service":"hackmit-api","ok":true}')):
            self.assertTrue(health.healthy(1, '/api/ready'))

    def test_stale_or_reused_pid_never_signalled(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'service.owner.json'
            owner = {'pid': 12345, 'group': 12345, 'start': '1', 'boot': 'old'}
            path.write_text(json.dumps(owner))
            with patch.object(process_owner, 'identity', return_value={**owner, 'start': '2'}), patch.object(process_owner.os, 'killpg') as kill:
                self.assertFalse(process_owner.stop(path)); kill.assert_not_called()
            with patch.object(process_owner, 'identity', return_value={**owner, 'boot': 'new'}), patch.object(process_owner.os, 'killpg') as kill:
                self.assertFalse(process_owner.stop(path)); kill.assert_not_called()
            with patch.object(process_owner, 'identity', side_effect=[owner, FileNotFoundError()]), patch.object(process_owner.os, 'killpg') as kill, patch.object(process_owner.time, 'sleep'):
                self.assertTrue(process_owner.stop(path)); kill.assert_called_once_with(12345, process_owner.signal.SIGTERM)
            self.assertFalse(path.exists())

if __name__ == '__main__': unittest.main()
