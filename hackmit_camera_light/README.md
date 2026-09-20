# hackmit_camera_light — the ring light on the ESP32-S3

> **Venue Wi-Fi:** this sketch needs the ESP32 on the same Wi-Fi as the GX10 with
> working mDNS. On `HackMIT.2026` that fails, so the demo ships the Bluetooth
> variant in [`hackmit_camera_light_ble/`](../hackmit_camera_light_ble/README.md)
> instead; the panel side is identical.

A 16-pixel NeoPixel ring (data on GPIO 19) on an ESP32-S3 DevKitC. It is
white while the 7 in. panel is in **Scan image** and off otherwise. The
panel decides; the ring mirrors. Wiring, in order:

```
panel view → panel/light.py → MQTT retained "on"/"off" on hackmit/scanlight
          → mosquitto on the GX10 (:1883, same Wi-Fi) → this sketch → ring
```

Retained is the whole trick: the ring can boot or reconnect at any moment and
the broker hands it the current state on subscribe. No toggle bookkeeping.

## Board state (Sat 19 Sep)

The board runs an Arduino build (ESP-IDF 5.5.2 via the esp32 core), **not
MicroPython** — its partition table is app0/app1/spiffs, and there is no
`main.py`. Its console is on the native USB port; the UART port
(CP210x, `/dev/ttyUSB0` on the GX10) is silent under the old build. This
sketch is compiled with the console on UART so `screen /dev/ttyUSB0 115200`
on the GX10 shows it.

## Build and flash

Credentials live in `secrets.h`, gitignored — copy `secrets.example.h`. The
Wi-Fi must be the one the GX10 is on; the broker is found by the GX10's mDNS
name with a fixed-IP fallback.

```bash
# once: brew install arduino-cli && arduino-cli core install esp32:esp32 \
#       && arduino-cli lib install PubSubClient "Adafruit NeoPixel"
arduino-cli compile --fqbn esp32:esp32:esp32s3 --export-binaries hackmit_camera_light
```

The board hangs off the GX10, so flash from there over the UART port:

```bash
tar cf - -C hackmit_camera_light/build esp32.esp32.esp32s3 | ssh gx10 'mkdir -p /tmp/ring && tar xf - -C /tmp/ring'
ssh gx10 '~/hackMIT26/.venv/bin/esptool --port /dev/ttyUSB0 --baud 921600 write-flash \
  0x0 /tmp/ring/esp32.esp32.esp32s3/hackmit_camera_light.ino.bootloader.bin \
  0x8000 /tmp/ring/esp32.esp32.esp32s3/hackmit_camera_light.ino.partitions.bin \
  0x10000 /tmp/ring/esp32.esp32.esp32s3/hackmit_camera_light.ino.bin'
```

(`boot_app0.bin` at 0xe000 only matters for OTA and is already on the board.)

## Test without the panel

```bash
mosquitto_pub -h localhost -t hackmit/scanlight -r -m on      # on the GX10
mosquitto_pub -h localhost -t hackmit/scanlight -r -m off
mosquitto_sub -h localhost -t 'hackmit/scanlight/#' -v         # state + online/offline
```

Pixel 0 dim red = no Wi-Fi, dim blue = Wi-Fi but no broker. Once subscribed
the ring only ever shows the state.
