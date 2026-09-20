"""The camera light: a NeoPixel ring on an ESP32-S3, driven over MQTT.

The rule is one line — white while the panel is in the scan view, off
otherwise — so this module is just the plumbing that turns a view change into
a retained MQTT message on the broker running on the GX10
(``hackmit/scanlight`` = ``on`` | ``off``). The firmware in
``hackmit_camera_light/`` mirrors that topic.

Retained matters: the ring may boot, lose Wi-Fi or reconnect at any point,
and the broker hands it the current state the moment it subscribes, so the
panel never has to know whether the ring is listening.

No MQTT library. A QoS 0 publish is a CONNECT, a PUBLISH and a DISCONNECT —
three short packets over a socket to localhost — and one fewer wheel to build
on the GX10. It runs on its own thread so a dead broker can never stall the
panel: the worst case is a warning in the log and a lamp that stays off.
"""

from __future__ import annotations

import os
import queue
import socket
import threading
import time
from typing import Optional


def _mqtt_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return len(b).to_bytes(2, "big") + b


def _packet(kind: int, body: bytes) -> bytes:
    # Fixed header: type/flags byte, then the remaining length as a varint.
    n = len(body)
    length = b""
    while True:
        digit = n % 128
        n //= 128
        length += bytes([digit | (0x80 if n else 0)])
        if not n:
            break
    return bytes([kind]) + length + body


def publish_once(host: str, port: int, topic: str, payload: str, *, retain: bool = True, timeout: float = 2.0) -> None:
    """One retained QoS 0 publish. Raises on any failure; the caller decides."""
    client_id = f"panel-{os.getpid()}"
    connect = _packet(
        0x10,
        _mqtt_str("MQTT") + bytes([4, 0x02]) + (60).to_bytes(2, "big") + _mqtt_str(client_id),
    )
    publish = _packet(0x30 | (0x01 if retain else 0), _mqtt_str(topic) + payload.encode("utf-8"))
    disconnect = bytes([0xE0, 0x00])
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(connect)
        ack = sock.recv(4)
        if len(ack) < 4 or ack[0] != 0x20 or ack[3] != 0:
            raise ConnectionError(f"broker refused connection: {ack.hex() or 'no CONNACK'}")
        sock.sendall(publish + disconnect)


class ScanLight:
    """Publishes the desired ring state, on change only, from a worker thread."""

    def __init__(
        self,
        broker: str = os.environ.get("PANEL_LIGHT_MQTT", "localhost:1883"),
        topic: str = os.environ.get("PANEL_LIGHT_TOPIC", "hackmit/scanlight"),
        enabled: bool = os.environ.get("PANEL_LIGHT", "1") != "0",
    ) -> None:
        host, _, port = broker.partition(":")
        self.host = host or "localhost"
        self.port = int(port or 1883)
        self.topic = topic
        self.enabled = enabled
        self.wanted: Optional[bool] = None       # last state asked for
        self.published: Optional[bool] = None    # last state the broker took
        self.error = ""
        self._queue: "queue.Queue[bool]" = queue.Queue()
        if enabled:
            threading.Thread(target=self._worker, name="scan-light", daemon=True).start()

    def set(self, on: bool) -> None:
        """Idempotent: repeated calls with the same state send nothing."""
        if not self.enabled or on == self.wanted:
            return
        self.wanted = on
        self._queue.put(on)

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "wanted": self.wanted,
            "published": self.published,
            "broker": f"{self.host}:{self.port}",
            "topic": self.topic,
            "error": self.error,
        }

    def _worker(self) -> None:
        while True:
            on = self._queue.get()
            # Coalesce: if the view flipped several times while we were busy,
            # only the latest state is worth sending.
            while True:
                try:
                    on = self._queue.get_nowait()
                except queue.Empty:
                    break
            payload = "on" if on else "off"
            for attempt in range(3):
                try:
                    publish_once(self.host, self.port, self.topic, payload)
                    self.published = on
                    self.error = ""
                    print(f"[light] {payload}", flush=True)
                    break
                except OSError as exc:
                    self.error = str(exc)
                    if attempt == 2:
                        print(f"[light] could not publish {payload} to {self.host}:{self.port}: {exc}", flush=True)
                    else:
                        time.sleep(0.5 * (attempt + 1))
