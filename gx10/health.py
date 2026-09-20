#!/usr/bin/env python3
"""Check identity and readiness, not merely an open HTTP port."""
import json
import sys
import urllib.request


def healthy(port, path):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as response:
            body = response.read(1_000_000)
        if path == "/":
            return b"IRL Physics Sim" in body and b"/src/main.ts" in body
        data = json.loads(body)
        if path == "/api/tags": return isinstance(data.get("models"), list)
        if path == "/api/state": return data.get("service") == "hackmit-panel" and "scan" in data
        if path == "/api/ready": return data.get("service") == "hackmit-api" and data.get("ok") is True
        return data.get("service") == "hackmit-api" and data.get("ok") is True
    except (OSError, ValueError):
        return False


if __name__ == "__main__":
    raise SystemExit(0 if healthy(int(sys.argv[1]), sys.argv[2]) else 1)
