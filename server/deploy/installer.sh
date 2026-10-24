#!/bin/sh
# Installerer eller opdaterer LAU-serveren på Debian/Ubuntu (kør som root). Kan køres igen – den overskriver ikke data
# eller /etc/lau/lau.env. Se server/README.md. Forudsætter Node 22.13+ og Python 3 (tjek.sh viser, hvad der mangler).
#   sh server/deploy/installer.sh
set -eu
REPO=${REPO:-https://github.com/Irate4147/lau-kort.git}
GREN=${GREN:-main}
KODE=/opt/lau-kort
VAR=/var/lib/lau

[ "$(id -u)" = 0 ] || { echo "Kør som root (sudo)"; exit 1; }
command -v node >/dev/null && node -e "require('node:sqlite')" 2>/dev/null || { echo "Mangler Node 22.13+ (fx fra NodeSource)"; exit 1; }
command -v python3 >/dev/null || { echo "Mangler python3"; exit 1; }
python3 -c "import cryptography" 2>/dev/null || apt-get install -y python3-cryptography

id lau >/dev/null 2>&1 || useradd --system --home "$VAR" --shell /usr/sbin/nologin lau
install -d -o lau -g lau -m 750 "$VAR" "$VAR/data" "$VAR/kalender" "$VAR/backup"
install -d -m 755 /etc/lau

if [ -d "$KODE/.git" ]; then git -C "$KODE" fetch -q origin "$GREN" && git -C "$KODE" checkout -q "$GREN" && git -C "$KODE" reset -q --hard "origin/$GREN"
else git clone -q --branch "$GREN" "$REPO" "$KODE"; fi
chown -R root:root "$KODE"

[ -f /etc/lau/lau.env ] || { install -m 640 -o root -g lau "$KODE/server/deploy/lau.env.eksempel" /etc/lau/lau.env; echo "Ret /etc/lau/lau.env (APIFY_TOKEN m.m.)"; }
install -m 644 "$KODE/server/deploy/lau.service" /etc/systemd/system/lau.service
install -m 755 "$KODE/server/deploy/lau" /usr/local/bin/lau
systemctl daemon-reload
systemctl enable -q lau
systemctl restart lau
sleep 1
systemctl --no-pager --lines=5 status lau || true
echo "Kører. Næste skridt: sudo lau flyt-data, sudo lau opret-bruger … admin og HTTPS (Caddy/nginx) – se server/README.md."
