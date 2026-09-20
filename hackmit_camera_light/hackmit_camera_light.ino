// HackMIT camera light — ESP32-S3 DevKitC + 16-pixel NeoPixel ring.
//
// The ring is white while the 7 in. panel is in "Scan image" and off the rest
// of the time. It does not decide that itself: panel/light.py on the GX10
// publishes the state as a *retained* MQTT message on hackmit/scanlight
// ("on" / "off"), and this sketch mirrors whatever the broker holds. Retained
// means a ring that boots or reconnects mid-demo gets the current state at
// once — no toggle bookkeeping, no missed-message inversions.
//
// Wi-Fi + broker come from secrets.h (gitignored; copy secrets.example.h).
// The broker is the GX10 on the same Wi-Fi; it is found by mDNS name first
// and a fixed IP second, so a hotspot handing out a new address does not
// need a reflash.
//
// Status while not connected (pixel 0 only, dim): red = no Wi-Fi,
// blue = Wi-Fi but no broker. Once subscribed the ring only shows the state.
//
// Build:  arduino-cli compile --fqbn esp32:esp32:esp32s3 hackmit_camera_light
// Flash:  see hackmit_camera_light/README.md (esptool over the UART port)

#include <WiFi.h>
#include <ESPmDNS.h>
#include <PubSubClient.h>
#include <Adafruit_NeoPixel.h>
#include "secrets.h"

// =========================
// Hardware
// =========================

#define LED_PIN 19
#define NUM_PIXELS 16

Adafruit_NeoPixel pixels(NUM_PIXELS, LED_PIN, NEO_GRB + NEO_KHZ800);

// =========================
// MQTT
// =========================

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif
#ifndef MQTT_TOPIC
#define MQTT_TOPIC "hackmit/scanlight"
#endif
#define STATUS_TOPIC MQTT_TOPIC "/status"

WiFiClient espClient;
PubSubClient mqtt(espClient);

// =========================
// State
// =========================

bool ledsOn = false;             // off until the broker says otherwise
bool mdnsStarted = false;
unsigned long lastWifiAttempt = 0;
unsigned long lastMqttAttempt = 0;

const unsigned long WIFI_RETRY_MS = 8000;
const unsigned long MQTT_RETRY_MS = 3000;

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
// table without a serial cable. Never shown once the ring is subscribed.
void showStatus(uint8_t r, uint8_t g, uint8_t b) {
  pixels.clear();
  pixels.setPixelColor(0, pixels.Color(r, g, b));
  pixels.show();
}

void setRing(bool on, const char* why) {
  if (on == ledsOn) return;
  ledsOn = on;
  showRing();
  Serial.printf("LEDs: %s (%s)\n", ledsOn ? "ON" : "OFF", why);
}

// =========================
// MQTT message received
// =========================

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, MQTT_TOPIC) != 0) return;

  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  msg.trim();
  msg.toLowerCase();

  if (msg == "on" || msg == "1" || msg == "true") {
    setRing(true, "mqtt");
  } else if (msg == "off" || msg == "0" || msg == "false") {
    setRing(false, "mqtt");
  } else if (msg == "toggle") {
    // Handy from a terminal: mosquitto_pub -t hackmit/scanlight -m toggle
    setRing(!ledsOn, "mqtt toggle");
  } else {
    Serial.printf("ignored payload '%s'\n", msg.c_str());
  }
}

// =========================
// Wi-Fi
// =========================

void startWiFi() {
  Serial.printf("WiFi: connecting to '%s'\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttempt = millis();
}

// =========================
// Broker lookup
// =========================

IPAddress resolveBroker() {
  IPAddress ip;
  if (ip.fromString(MQTT_HOST)) return ip;          // already an IP

  if (!mdnsStarted) {
    mdnsStarted = MDNS.begin("hackmit-light");
  }
  if (mdnsStarted) {
    ip = MDNS.queryHost(MQTT_HOST, 2000);
    if (ip != IPAddress(0, 0, 0, 0)) {
      Serial.printf("broker: %s.local -> %s\n", MQTT_HOST, ip.toString().c_str());
      return ip;
    }
  }
#ifdef MQTT_FALLBACK
  if (ip.fromString(MQTT_FALLBACK)) {
    Serial.printf("broker: mDNS failed, using fallback %s\n", MQTT_FALLBACK);
    return ip;
  }
#endif
  return IPAddress(0, 0, 0, 0);
}

// =========================
// MQTT connect (one attempt, non-blocking loop retries)
// =========================

bool connectMQTT() {
  IPAddress broker = resolveBroker();
  if (broker == IPAddress(0, 0, 0, 0)) {
    Serial.println("broker: no address");
    return false;
  }
  mqtt.setServer(broker, MQTT_PORT);

  String clientId = "ESP32S3-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.printf("MQTT: connecting to %s:%d as %s... ", broker.toString().c_str(), MQTT_PORT, clientId.c_str());

  // Last will: the broker announces us gone if we drop off. Lets anyone on
  // the box check `mosquitto_sub -t hackmit/scanlight/status` for the ring.
  if (!mqtt.connect(clientId.c_str(), STATUS_TOPIC, 0, true, "offline")) {
    Serial.printf("failed, state=%d\n", mqtt.state());
    return false;
  }
  Serial.println("connected");
  mqtt.publish(STATUS_TOPIC, "online", true);
  mqtt.subscribe(MQTT_TOPIC);           // retained state arrives immediately
  Serial.printf("subscribed to %s\n", MQTT_TOPIC);
  return true;
}

// =========================
// Setup / loop
// =========================

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("hackmit camera light");

  pixels.begin();
  pixels.clear();
  pixels.show();                       // dark until told otherwise

  mqtt.setCallback(mqttCallback);
  mqtt.setKeepAlive(15);
  startWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    showStatus(24, 0, 0);              // red: no Wi-Fi
    if (millis() - lastWifiAttempt > WIFI_RETRY_MS) {
      WiFi.disconnect();
      startWiFi();
    }
    delay(100);
    return;
  }

  if (!mqtt.connected()) {
    showStatus(0, 0, 24);              // blue: Wi-Fi up, no broker yet
    if (millis() - lastMqttAttempt > MQTT_RETRY_MS) {
      lastMqttAttempt = millis();
      if (connectMQTT()) showRing();   // back to plain state display
    }
    delay(50);
    return;
  }

  mqtt.loop();
}
