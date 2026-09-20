#!/usr/bin/env bash
# GX10 provisioning used during initial setup; see gx10/README.md.
# Retains legacy serial packages/permissions from the former sensor plan.
# The active webcam-only, two-display demo does not need a sensor bridge.
# Run ON the GX10 as the login user (asus):  bash ~/hackMIT26/gx10/setup.sh
# What it does and why: gx10/README.md. Verified on DGX OS / Ubuntu 24.04.4, Sat 19 Sep 2026.
set -euo pipefail

echo "== ssh + serial access =="
sudo systemctl enable --now ssh
sudo usermod -aG dialout "$USER"            # /dev/ttyUSB* for the ESP32 (re-login to apply)

echo "== never sleep, never blank: a dark 7in screen mid-demo looks like a crash =="
sudo systemctl mask sleep.target suspend.target hibernate.target || true
gsettings set org.gnome.desktop.session idle-delay 0 || true
gsettings set org.gnome.desktop.screensaver lock-enabled false || true
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing || true

echo "== ollama: listen on loopback, keep models resident =="
command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null <<'CONF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1"
Environment="OLLAMA_KEEP_ALIVE=-1"
CONF
sudo systemctl daemon-reload
sudo systemctl enable --now ollama
sudo systemctl restart ollama

echo "== models (qwen3.8 + nemotron ship preinstalled; qwen3-vl:8b is the fast ingest option) =="
for m in qwen3.8 nemotron-3.5-lightning qwen3-vl:8b; do
  ollama list | grep -q "^$m" || ollama pull "$m" || echo "!! could not pull $m (offline?) — continuing"
done

echo "== browser + serial bridge deps =="
command -v chromium >/dev/null || sudo snap install chromium
sudo snap connect chromium:raw-usb 2>/dev/null || true
sudo apt-get install -y -qq python3-serial python3-websockets >/dev/null

echo "== mqtt broker for the camera ring light (hackmit_camera_light/) =="
sudo apt-get install -y -qq mosquitto mosquitto-clients >/dev/null
sudo tee /etc/mosquitto/conf.d/hackmit.conf >/dev/null <<'CONF'
# Local publisher only by default. See gx10/README.md for restricted ESP32 access.
listener 1883 127.0.0.1
allow_anonymous true
CONF
sudo systemctl enable --now mosquitto
sudo systemctl restart mosquitto

echo "== app =="
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs; }
cd "$(dirname "$0")/.." && npm ci --silent
[ -f .env ] || cp .env.example .env

echo
echo "done. warm the models once (first load is ~30 s each):"
echo "  curl -s localhost:11434/api/chat -d '{\"model\":\"qwen3.8\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false}' >/dev/null"
echo "then:  npm run dev   and open http://localhost:5173 in chromium"
