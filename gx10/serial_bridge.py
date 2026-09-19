#!/usr/bin/env python3
"""
ESP32 serial -> browser WebSocket bridge.

Why this exists: the browser on the GX10 is snap Chromium (or Firefox), and
neither can open /dev/ttyUSB0 via WebSerial — the snap's `serial-port`
interface has no slot to connect to on a normal system, and Firefox has no
WebSerial at all. So the sensor stream goes serial -> this script -> ws://.
It is also simply more robust than WebSerial: no port-picker dialog that needs
a click on the touchscreen, and it reconnects on its own if the ESP32 resets.

Protocol (plan §8): the ESP32 prints one JSON object per line at 115200 baud.
This forwards every line verbatim to every connected WebSocket client and
never parses it, so the firmware and the browser agree on the schema and this
file never needs to change.

Run:   python3 gx10/serial_bridge.py [--port /dev/ttyUSB0] [--baud 115200] [--ws 8765]
Browser:  new WebSocket('ws://localhost:8765').onmessage = e => JSON.parse(e.data)
"""
import argparse
import asyncio
import glob
import sys
import time

import serial  # pyserial
import websockets

clients: set = set()


def find_port(explicit: str | None) -> str | None:
    if explicit:
        return explicit
    for pat in ("/dev/ttyUSB*", "/dev/ttyACM*"):
        found = sorted(glob.glob(pat))
        if found:
            return found[0]
    return None


async def ws_handler(ws):
    clients.add(ws)
    try:
        await ws.wait_closed()
    finally:
        clients.discard(ws)


async def broadcast(line: str):
    if not clients:
        return
    await asyncio.gather(*(c.send(line) for c in list(clients)), return_exceptions=True)


async def serial_loop(port_arg: str | None, baud: int):
    """Open the port, forward lines, and re-open forever if it goes away."""
    last_report = 0.0
    while True:
        port = find_port(port_arg)
        if port is None:
            if time.time() - last_report > 5:
                print("no /dev/ttyUSB* or /dev/ttyACM* yet — waiting for the ESP32", file=sys.stderr)
                last_report = time.time()
            await asyncio.sleep(1)
            continue
        try:
            ser = serial.Serial(port, baud, timeout=0.1)
            print(f"serial open: {port} @ {baud}", file=sys.stderr)
            n = 0
            while True:
                raw = await asyncio.to_thread(ser.readline)
                if not raw:
                    continue
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("{"):
                    continue  # boot chatter, partial line
                await broadcast(line)
                n += 1
                if n % 500 == 0:
                    print(f"{n} lines forwarded, {len(clients)} client(s)", file=sys.stderr)
        except (serial.SerialException, OSError) as e:
            print(f"serial lost ({e}); retrying", file=sys.stderr)
            await asyncio.sleep(1)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=None, help="serial device (default: first ttyUSB*/ttyACM*)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--ws", type=int, default=8765, help="WebSocket port")
    a = ap.parse_args()
    async with websockets.serve(ws_handler, "127.0.0.1", a.ws):
        print(f"ws://localhost:{a.ws}", file=sys.stderr)
        await serial_loop(a.port, a.baud)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
