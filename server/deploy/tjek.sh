#!/bin/sh
# Kør på serveren, før LAU-serveren installeres – udskriver det, der skal vides om maskinen (ændrer intet):
#   curl -fsSL https://raw.githubusercontent.com/Irate4147/lau-kort/main/server/deploy/tjek.sh | sh
# eller: sh server/deploy/tjek.sh [kort.liberaleunge.dk]
DOMAENE="${1:-kort.liberaleunge.dk}"
linje() { printf '\n== %s\n' "$1"; }
har() { command -v "$1" >/dev/null 2>&1; }

linje "System"
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
uname -srm
echo "CPU: $(nproc 2>/dev/null) · RAM: $(free -h 2>/dev/null | awk '/Mem:/ {print $2 " (fri " $7 ")"}')"
df -h / /var 2>/dev/null | awk 'NR == 1 || !seen[$1]++'
echo "Bruger: $(id -un)$([ "$(id -u)" = 0 ] && echo ' (root)' || { sudo -n true 2>/dev/null && echo ' (sudo uden kode)' || echo ' (ingen root)'; })"

linje "Værktøjer"
for v in node npm python3 pip3 git sqlite3 docker caddy nginx apache2 httpd certbot ufw; do
  if har "$v"; then printf '%-8s %s\n' "$v" "$($v --version 2>&1 | head -1)"; else printf '%-8s –\n' "$v"; fi
done
har python3 && python3 -c "import cryptography; print('python3 cryptography', cryptography.__version__)" 2>/dev/null || echo "python3 cryptography –"
har node && node -e "require('node:sqlite'); console.log('node:sqlite ok')" 2>/dev/null || echo "node:sqlite – (kræver Node 22.13+)"

linje "Kører allerede (porte 80, 443, 8080)"
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | awk 'NR == 1 || /:(80|443|8080) /'
har systemctl && systemctl list-units --type=service --state=running --no-pager 2>/dev/null | grep -Ei 'nginx|apache|httpd|caddy|docker|php|mysql|maria|postgres|wordpress' || true

linje "Websider på maskinen"
ls /etc/nginx/sites-enabled /etc/apache2/sites-enabled /etc/caddy 2>/dev/null
ls -d /var/www/* 2>/dev/null

linje "DNS"
for d in "$DOMAENE" liberaleunge.dk; do
  printf '%-24s %s\n' "$d" "$(getent hosts "$d" 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
done
echo "Maskinens offentlige IP: $(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || echo ukendt)"
