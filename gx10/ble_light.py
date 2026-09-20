#!/usr/bin/env python3
"""
MQTT -> Bluetooth bridge for the camera ring light.

panel/light.py publishes the ring state as a retained message on
``hackmit/scanlight`` (``on`` | ``off``) to the mosquitto broker on the GX10.
The original ring (hackmit_camera_light/) subscribed to that topic over Wi-Fi,
which venue Wi-Fi breaks (no mDNS, ESP32 often refused). The BLE ring
(hackmit_camera_light_ble/) has no radio in common with the panel, so this
script sits between them: it subscribes to the topic on loopback and writes
whatever the broker holds into the ring's GATT characteristic with the box's
own Bluetooth adapter. The panel, its tests and `mosquitto_pub -t
hackmit/scanlight -r -m on` keep working exactly as before.

Behaviour
- Connects to the first BLE peripheral named ``hackmit-light`` (or
  ``--address``), retries forever, reconnects after any drop.
- Every (re)connect rewrites the current state, so the ring never depends on
  having been listening when the panel changed view.
- Publishes ``hackmit/scanlight/ble`` = ``connected`` | ``disconnected``
  (retained) so `mosquitto_sub -t 'hackmit/scanlight/#' -v` shows the ring.
- Exits 0 on SIGTERM after writing ``off`` — demo-stop.sh kills the tree.

Run:  .venv/bin/python gx10/ble_light.py [--name hackmit-light | --address AA:BB:..]
                                          [--broker localhost:1883] [--topic hackmit/scanlight]
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys
import time

import paho.mqtt.client as mqtt
from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError

LIGHT_CHAR_UUID = "8ac1a001-0f1e-4c2b-9a3d-5c4e6f708090"

log = logging.getLogger("ble-light")


class Bridge:
    def __init__(self, name: str, address: str | None, broker: str, topic: str) -> None:
        self.name, self.address = name, address
        host, _, port = broker.partition(":")
        self.host, self.port = host or "localhost", int(port or 1883)
        self.topic = topic
        self.wanted: bool | None = None       # newest state the broker holds
        self.written: bool | None = None      # last state the ring accepted
        self.changed = asyncio.Event()
        self.stopping = asyncio.Event()
        self.loop = asyncio.get_event_loop()
        self.mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="ble-light-bridge")
        self.mqtt.on_connect = self._on_mqtt_connect
        self.mqtt.on_message = self._on_mqtt_message

    # ---- MQTT (paho runs its own thread; hand results to the asyncio loop) ----

    def _on_mqtt_connect(self, client, _userdata, _flags, reason, _props=None):
        log.info("mqtt: connected to %s:%d (%s), subscribing %s", self.host, self.port, reason, self.topic)
        client.subscribe(self.topic)

    def _on_mqtt_message(self, _client, _userdata, msg):
        payload = msg.payload.decode("utf-8", "replace").strip().lower()
        if payload in ("on", "1", "true"):
            on = True
        elif payload in ("off", "0", "false"):
            on = False
        else:
            log.warning("mqtt: ignored payload %r", payload)
            return
        self.loop.call_soon_threadsafe(self._set_wanted, on)

    def _set_wanted(self, on: bool) -> None:
        if on != self.wanted:
            self.wanted = on
            self.changed.set()

    def publish_status(self, state: str) -> None:
        try:
            self.mqtt.publish(f"{self.topic}/ble", state, retain=True)
        except Exception as exc:  # broker down: status is best-effort
            log.debug("mqtt status publish failed: %s", exc)

    # ---- BLE ----

    async def find(self) -> str | None:
        if self.address:
            return self.address
        dev = await BleakScanner.find_device_by_name(self.name, timeout=8.0)
        return dev.address if dev else None

    async def serve_connection(self, address: str) -> None:
        disconnected = asyncio.Event()

        def on_disconnect(_client):
            self.loop.call_soon_threadsafe(disconnected.set)

        async with BleakClient(address, disconnected_callback=on_disconnect, timeout=15.0) as client:
            log.info("ble: connected to %s", address)
            self.publish_status("connected")
            self.written = None                    # force a rewrite after (re)connect
            while not self.stopping.is_set() and not disconnected.is_set():
                if self.wanted is not None and self.wanted != self.written:
                    payload = b"on" if self.wanted else b"off"
                    await client.write_gatt_char(LIGHT_CHAR_UUID, payload, response=True)
                    self.written = self.wanted
                    log.info("ble: ring %s", payload.decode())
                self.changed.clear()
                waiters = [asyncio.create_task(self.changed.wait()),
                           asyncio.create_task(disconnected.wait()),
                           asyncio.create_task(self.stopping.wait())]
                # Refresh the write every 20 s: cheap, and it doubles as a liveness probe.
                done, pending = await asyncio.wait(waiters, timeout=20.0, return_when=asyncio.FIRST_COMPLETED)
                for t in pending:
                    t.cancel()
                if not done and self.written is not None:
                    self.written = None
            if self.stopping.is_set() and client.is_connected:
                try:
                    await client.write_gatt_char(LIGHT_CHAR_UUID, b"off", response=True)
                    log.info("ble: ring off (shutdown)")
                except BleakError as exc:
                    log.warning("ble: could not turn ring off on shutdown: %s", exc)

    async def run(self) -> None:
        self.mqtt.connect_async(self.host, self.port, keepalive=30)
        self.mqtt.loop_start()
        backoff = 1.0
        try:
            while not self.stopping.is_set():
                try:
                    address = await self.find()
                    if not address:
                        log.info("ble: '%s' not found, is the ring powered? retrying", self.name)
                        raise BleakError("not found")
                    await self.serve_connection(address)
                    backoff = 1.0
                    if not self.stopping.is_set():
                        log.warning("ble: disconnected")
                except (BleakError, asyncio.TimeoutError, OSError) as exc:
                    log.warning("ble: %s — retry in %.0fs", exc, backoff)
                    self.publish_status("disconnected")
                    try:
                        await asyncio.wait_for(self.stopping.wait(), timeout=backoff)
                    except asyncio.TimeoutError:
                        pass
                    backoff = min(backoff * 2, 10.0)
                else:
                    self.publish_status("disconnected")
        finally:
            self.publish_status("disconnected")
            time.sleep(0.2)                        # let the retained status go out
            self.mqtt.loop_stop()
            self.mqtt.disconnect()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", default="hackmit-light", help="BLE device name to look for")
    ap.add_argument("--address", default=None, help="skip scanning, connect to this BLE address")
    ap.add_argument("--broker", default="localhost:1883")
    ap.add_argument("--topic", default="hackmit/scanlight")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s", stream=sys.stdout)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    bridge = Bridge(args.name, args.address, args.broker, args.topic)
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, bridge.stopping.set)
    try:
        loop.run_until_complete(bridge.run())
    finally:
        loop.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
