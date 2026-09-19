#include <WiFi.h>
#include <PubSubClient.h>
#include <Adafruit_NeoPixel.h>

// =========================
// NeoPixel
// =========================

#define LED_PIN 19
#define NUM_PIXELS 16

Adafruit_NeoPixel pixels(
  NUM_PIXELS,
  LED_PIN,
  NEO_GRB + NEO_KHZ800
);

// =========================
// WiFi
// =========================

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// =========================
// MQTT
// =========================

// Replace with your MQTT broker
const char* MQTT_SERVER = "YOUR_MQTT_BROKER";
const int MQTT_PORT = 1883;

// Topic to listen for
const char* MQTT_TOPIC = "led/toggle";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// =========================
// LED state
// =========================

bool ledsOn = true;


// =========================
// Set all LEDs
// =========================

void updateLEDs() {

  if (ledsOn) {

    // All white
    for (int i = 0; i < NUM_PIXELS; i++) {
      pixels.setPixelColor(
        i,
        pixels.Color(255, 255, 255)
      );
    }

  } else {

    // All off
    pixels.clear();
  }

  pixels.show();
}


// =========================
// MQTT message received
// =========================

void mqttCallback(char* topic, byte* payload, unsigned int length) {

  // Any message on the topic toggles the LEDs
  if (strcmp(topic, MQTT_TOPIC) == 0) {

    ledsOn = !ledsOn;

    updateLEDs();

    Serial.print("LEDs: ");
    Serial.println(ledsOn ? "ON" : "OFF");
  }
}


// =========================
// Connect WiFi
// =========================

void connectWiFi() {

  Serial.print("Connecting to WiFi");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected!");

  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}


// =========================
// Connect MQTT
// =========================

void connectMQTT() {

  while (!mqttClient.connected()) {

    Serial.print("Connecting to MQTT...");

    // Generate a unique client ID
    String clientID = "ESP32S3-" + String((uint32_t)ESP.getEfuseMac(), HEX);

    if (mqttClient.connect(clientID.c_str())) {

      Serial.println("connected!");

      // Subscribe to toggle topic
      mqttClient.subscribe(MQTT_TOPIC);

      Serial.print("Subscribed to: ");
      Serial.println(MQTT_TOPIC);

    } else {

      Serial.print("failed, state=");
      Serial.println(mqttClient.state());

      delay(2000);
    }
  }
}


// =========================
// Setup
// =========================

void setup() {

  Serial.begin(115200);

  // Initialize NeoPixels
  pixels.begin();
  pixels.clear();

  // Start with LEDs ON
  ledsOn = true;
  updateLEDs();

  // Connect WiFi
  connectWiFi();

  // Configure MQTT
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  // Connect MQTT
  connectMQTT();
}


// =========================
// Main loop
// =========================

void loop() {

  // Reconnect WiFi if necessary
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Reconnect MQTT if necessary
  if (!mqttClient.connected()) {
    connectMQTT();
  }

  // Process incoming MQTT messages
  mqttClient.loop();
}