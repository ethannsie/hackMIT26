// HackMIT camera light over Bluetooth — ESP32-S3 DevKitC + 16-pixel NeoPixel ring.
//
// Same job as hackmit_camera_light/ (white while the 7 in. panel is in "Scan
// image", off otherwise) with no Wi-Fi in the loop: venue Wi-Fi blocks mDNS
// and often the ESP32 itself, so the ring is a BLE peripheral instead and the
// GX10 talks to it directly with its own radio. gx10/ble_light.py on the box
// subscribes to the retained hackmit/scanlight MQTT topic that panel/light.py
// already publishes and writes the state into one GATT characteristic.
//
// GATT: service LIGHT_SERVICE_UUID with one characteristic LIGHT_CHAR_UUID,
// read/write/notify, payload "on" | "off" | "toggle" (same words as MQTT).
// The bridge rewrites the current state on every connect, which stands in for
// MQTT retention, and the ring turns itself off if nobody has been connected
// for LONELY_OFF_MS so a dead panel cannot leave it burning.
//
// Status while no central is connected (pixel 0 only, dim): blue = advertising.
// Once connected the ring only shows the state.
//
// Build:  arduino-cli compile --fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app \
//           --export-binaries hackmit_camera_light_ble
// Flash:  see hackmit_camera_light_ble/README.md (esptool over the UART port)

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Adafruit_NeoPixel.h>

// =========================
// Hardware
// =========================

#define LED_PIN 19
#define NUM_PIXELS 16

Adafruit_NeoPixel pixels(NUM_PIXELS, LED_PIN, NEO_GRB + NEO_KHZ800);

// =========================
// BLE
// =========================

#define DEVICE_NAME "hackmit-light"
#define LIGHT_SERVICE_UUID "8ac1a000-0f1e-4c2b-9a3d-5c4e6f708090"
#define LIGHT_CHAR_UUID    "8ac1a001-0f1e-4c2b-9a3d-5c4e6f708090"

const unsigned long LONELY_OFF_MS = 30000;

BLEServer* server = nullptr;
BLECharacteristic* lightChar = nullptr;

// =========================
// State
// =========================

bool ledsOn = false;             // off until the box says otherwise
bool connected = false;
unsigned long disconnectedAt = 0;

// =========================
// Ring
// =========================

void showRing() {
  if (ledsOn) {
    for (int i = 0; i < NUM_PIXELS; i++) {
      pixels.setPixelColor(i, pixels.Color(255, 255, 255));
    }
  } else {
    pixels.clear();
  }
  pixels.show();
}

// A single dim pixel so "is it connected?" is answerable from across the
// table without a serial cable. Never shown while a central is connected.
void showStatus(uint8_t r, uint8_t g, uint8_t b) {
  pixels.clear();
  pixels.setPixelColor(0, pixels.Color(r, g, b));
  pixels.show();
}

void setRing(bool on, const char* why) {
  if (on != ledsOn) {
    ledsOn = on;
    Serial.printf("LEDs: %s (%s)\n", ledsOn ? "ON" : "OFF", why);
  }
  showRing();
  if (lightChar) {
    lightChar->setValue(ledsOn ? "on" : "off");
    if (connected) lightChar->notify();
  }
}

// =========================
// GATT callbacks
// =========================

void applyCommand(String msg, const char* why) {
  msg.trim();
  msg.toLowerCase();
  if (msg == "on" || msg == "1" || msg == "true") {
    setRing(true, why);
  } else if (msg == "off" || msg == "0" || msg == "false") {
    setRing(false, why);
  } else if (msg == "toggle") {
    setRing(!ledsOn, "ble toggle");
  } else {
    Serial.printf("ignored payload '%s'\n", msg.c_str());
  }
}

class LightWrite : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    applyCommand(String(c->getValue().c_str()), "ble");
  }
};

class ServerEvents : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    connected = true;
    Serial.println("BLE: central connected");
    showRing();                      // drop the status pixel, show the state
  }
  void onDisconnect(BLEServer* s) override {
    connected = false;
    disconnectedAt = millis();
    Serial.println("BLE: central disconnected, advertising again");
    s->startAdvertising();
    if (!ledsOn) showStatus(0, 0, 40);
  }
};

// =========================
// Setup / loop
// =========================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nHackMIT camera light (BLE) booting");

  pixels.begin();
  pixels.setBrightness(255);
  showStatus(0, 0, 40);            // dim blue: advertising, nobody connected

  BLEDevice::init(DEVICE_NAME);
  server = BLEDevice::createServer();
  server->setCallbacks(new ServerEvents());

  BLEService* svc = server->createService(LIGHT_SERVICE_UUID);
  lightChar = svc->createCharacteristic(
      LIGHT_CHAR_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE |
      BLECharacteristic::PROPERTY_WRITE_NR | BLECharacteristic::PROPERTY_NOTIFY);
  lightChar->addDescriptor(new BLE2902());
  lightChar->setCallbacks(new LightWrite());
  lightChar->setValue("off");
  svc->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(LIGHT_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);      // iOS-friendly intervals; harmless for BlueZ
  adv->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  disconnectedAt = millis();
  Serial.printf("BLE: advertising as '%s'\n", DEVICE_NAME);
}

void loop() {
  // Safety: a box that vanished mid-scan must not leave the ring on forever.
  if (!connected && ledsOn && millis() - disconnectedAt > LONELY_OFF_MS) {
    setRing(false, "no central for 30 s");
    showStatus(0, 0, 40);
  }
  // Serial still works while the board hangs off the box's USB: "on"/"off".
  if (Serial.available()) {
    applyCommand(Serial.readStringUntil('\n'), "serial");
  }
  delay(20);
}
