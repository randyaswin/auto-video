#!/bin/bash
# Memasang dua layanan systemd user di laptop supaya pipeline tidak pernah lagi mati diam-diam:
#   bang-story.service    — server web (mati = semua langkah produksi gagal "fetch failed")
#   lf-supervisor.service — supervisor render long-form (bertahan setelah putus SSH / reboot)
# Jalankan sekali di laptop:  bash scripts/install-laptop-services.sh
# Status: systemctl --user status bang-story lf-supervisor
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/bang-story.service" <<EOF
[Unit]
Description=Bang Story web server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO
Environment=BANG_STORY_HOST=100.115.185.3
Environment=BANG_STORY_PORT=4627
ExecStart=/usr/bin/node $REPO/out/server/index.cjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/lf-supervisor.service" <<EOF
[Unit]
Description=Bang Story long-form render supervisor (retry bertahap sampai selesai)
After=bang-story.service

[Service]
Type=simple
WorkingDirectory=$REPO
Environment=BANG_STORY_URL=http://100.115.185.3:4627
ExecStart=/usr/bin/bash $REPO/scripts/lf-supervisor.sh
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now bang-story.service
loginctl enable-linger "$USER" 2>/dev/null || true
echo "Terpasang. Status:"
systemctl --user is-active bang-story.service
echo "Supervisor render long-form dipasang terpisah supaya bisa dimatikan setelah long-form selesai:"
echo "  systemctl --user enable --now lf-supervisor.service"
