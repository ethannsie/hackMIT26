# Camera ring light over Bluetooth

ESP32-S3 DevKitC + 16-pixel NeoPixel ring on GPIO 19, same hardware as
[`hackmit_camera_light/`](../hackmit_camera_light/README.md), but the ring is a
**BLE peripheral** instead of a Wi-Fi MQTT client. Venue Wi-Fi blocks mDNS and
tends to refuse the ESP32, so the box drives the ring with its own Bluetooth
adapter and nothing leaves the GX10.

```
panel/light.py ──MQTT (loopback)──▶ mosquitto ──▶ gx10/ble_light.py ──BLE──▶ ring
```

- The panel is unchanged: it still publishes the retained `hackmit/scanlight`
  = `on` | `off`.
- `gx10/ble_light.py` (started by `gx10/demo.sh`) subscribes to that topic and
  writes the state into one GATT characteristic. It rewrites the state on every
  (re)connect, which stands in for MQTT retention, and publishes
  `hackmit/scanlight/ble` = `connected` | `disconnected`.
- The ring turns itself off after 30 s with no central connected, so a dead
  box cannot leave it burning.

| GATT | UUID |
|---|---|
| device name | `hackmit-light` |
| service | `8ac1a000-0f1e-4c2b-9a3d-5c4e6f708090` |
| characteristic (read / write / notify) | `8ac1a001-0f1e-4c2b-9a3d-5c4e6f708090`, payload `on` / `off` / `toggle` |

Pixel 0 dim blue = advertising, nobody connected. Once the box connects the
ring only ever shows the state. No `secrets.h` needed — there is nothing to
join.

## Build and flash

Needs the `huge_app` partition scheme (the BLE stack does not fit the 1.2 MB
default app slot).

```bash
# once: brew install arduino-cli && arduino-cli core install esp32:esp32 \
#       && arduino-cli lib install "Adafruit NeoPixel"
arduino-cli compile --fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app --export-binaries hackmit_camera_light_ble
```

The board hangs off the GX10, so flash from there over the UART port:

```bash
tar cf - -C hackmit_camera_light_ble/build esp32.esp32.esp32s3 | ssh gx10 'mkdir -p /tmp/ring-ble && tar xf - -C /tmp/ring-ble'
ssh gx10 'cd /tmp/ring-ble/esp32.esp32.esp32s3 && ~/hackMIT26/.venv/bin/esptool --port /dev/ttyUSB0 --baud 921600 write-flash \
  0x0 hackmit_camera_light_ble.ino.bootloader.bin 0x8000 hackmit_camera_light_ble.ino.partitions.bin \
  0xe000 boot_app0.bin 0x10000 hackmit_camera_light_ble.ino.bin'
```

Kill anything holding `/dev/ttyUSB0` first (`fuser -v /dev/ttyUSB0`).

## Test without the panel

```bash
mosquitto_pub -h localhost -t hackmit/scanlight -r -m on      # on the GX10
mosquitto_pub -h localhost -t hackmit/scanlight -r -m off
mosquitto_sub -h localhost -t 'hackmit/scanlight/#' -v         # state + ble connected/disconnected
tail -f ~/hackMIT26/.demo/ble-light.log                        # the bridge's view
```

Bypassing MQTT entirely (bridge stopped), from the box:

```bash
bluetoothctl scan on   # look for hackmit-light
.venv/bin/python -c "import asyncio,bleak; asyncio.run(bleak.BleakClient('A4:CB:8F:E1:D6:F1').__aenter__().write_gatt_char('8ac1a001-0f1e-4c2b-9a3d-5c4e6f708090', b'toggle'))"
```

The Wi-Fi firmware still lives in `hackmit_camera_light/` if a hotspot is ever
the better option again; flash whichever one matches the venue.
