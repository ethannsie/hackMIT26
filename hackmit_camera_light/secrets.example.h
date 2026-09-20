// Copy to secrets.h (gitignored) and fill in. The ring must be on the same
// Wi-Fi as the GX10, because the GX10 runs the MQTT broker it listens to.
#pragma once
#define WIFI_SSID     "the hotspot / network the GX10 is on"
#define WIFI_PASSWORD "its password"
#define MQTT_HOST     "gx10-f443"      // GX10's mDNS host name (no .local); an IP works too
#define MQTT_FALLBACK "172.20.10.5"    // GX10's IP on that network, used if mDNS fails
// #define MQTT_PORT  1883
// #define MQTT_TOPIC "hackmit/scanlight"
