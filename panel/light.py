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
        ack = b""
        while len(ack) < 4:
            chunk = sock.recv(4 - len(ack))
            if not chunk:
                break
            ack += chunk
        if len(ack) < 4 or ack[0] != 0x20 or ack[3] != 0:
            raise ConnectionError(f"broker refused connection: {ack.hex() or 'no CONNACK'}")
        sock.sendall(publish + disconnect)


class ScanLight:
    """Reconciles the newest desired state, retries failures and refreshes retention."""

    def __init__(
        self,
        broker: str = os.environ.get("PANEL_LIGHT_MQTT", "localhost:1883"),
        topic: str = os.environ.get("PANEL_LIGHT_TOPIC", "hackmit/scanlight"),
        enabled: bool = os.environ.get("PANEL_LIGHT", "1") != "0",
        refresh_s: float = 20.0,
        retry_s: float = 1.0,
    ) -> None:
        host, _, port = broker.partition(":")
        self.host = host or "localhost"
        self.port = int(port or 1883)
        self.topic = topic
        self.enabled = enabled
        self.wanted: Optional[bool] = None       # last state asked for
        self.published: Optional[bool] = None    # last state the broker took
        self.error = ""
        self._condition = threading.Condition()
        self._stopped = False
        self._refresh_s, self._retry_s = refresh_s, retry_s
        self._thread: Optional[threading.Thread] = None
        if enabled:
            self._thread = threading.Thread(target=self._worker, name="scan-light", daemon=True)
            self._thread.start()

    def set(self, on: bool) -> None:
        with self._condition:
            if not self.enabled or self._stopped or on == self.wanted:
                return
            self.wanted = on
            self._condition.notify_all()

    def stop(self) -> None:
        with self._condition:
            self._stopped = True
            self._condition.notify_all()
        if self._thread:
            self._thread.join(timeout=3)
        if self.enabled:
            try:
                publish_once(self.host, self.port, self.topic, "off")
                self.published = self.wanted = False
            except OSError as exc:
                self.error = str(exc)

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
        due = 0.0
        last_attempt = None
        while True:
            with self._condition:
                while not self._stopped and (self.wanted is None or (self.wanted == last_attempt and time.monotonic() < due)):
                    self._condition.wait(timeout=max(0.01, due - time.monotonic()) if self.wanted is not None else None)
                if self._stopped:
                    return
                on = self.wanted
                last_attempt = on
            try:
                publish_once(self.host, self.port, self.topic, "on" if on else "off")
                self.published = on
                self.error = ""
                due = time.monotonic() + self._refresh_s
            except OSError as exc:
                self.error = str(exc)
                due = time.monotonic() + self._retry_s
