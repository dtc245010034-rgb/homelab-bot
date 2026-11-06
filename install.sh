#!/usr/bin/env bash
# Cai dat homelab-bot tren Linux (Debian/Ubuntu/Raspberry Pi OS).
# Dung:  ./install.sh            cai thu vien + chay trinh cai dat cau hinh
#        ./install.sh --pm2      them: chay nen bang pm2, tu khoi dong lai cung may
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\033[1;31mLoi:\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "Chua co Node.js. Cai Node 20+ (https://nodejs.org hoac: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Can Node.js >= 20 (dang co $(node -v))."
command -v npm >/dev/null || die "Chua co npm."

say "Cai thu vien Node (npm install)"
npm install --omit=dev --no-audit --no-fund

say "Kiem tra cong cu he thong (tuy chon, chi can cho tinh nang tuong ung)"
for pair in "ffmpeg:/cam va canh bao chuyen dong" "convert:/wmap (ban do mua; goi imagemagick)" "ip:/netscan (goi iproute2)" "sensors:/temp (goi lm-sensors)" "pm2:/pm2 va chay nen" "tailscale:/ts" "pihole:/pihole"; do
  bin=${pair%%:*}; feat=${pair#*:}
  command -v "$bin" >/dev/null && echo "  co    $bin" || warn "thieu  $bin  -> $feat"
done
echo "  Cai nhanh:  sudo apt install -y ffmpeg imagemagick iproute2 lm-sensors"

if [ ! -f .env ]; then
  say "Tao cau hinh (.env)"
  npm run --silent setup
else
  say "Da co .env, bo qua buoc cau hinh (muon lam lai: npm run setup)"
fi

if [ "${1:-}" = "--pm2" ]; then
  command -v pm2 >/dev/null || { say "Cai pm2"; npm install -g pm2 || die "Cai pm2 that bai. Thu: sudo npm install -g pm2"; }
  say "Chay nen bang pm2"
  pm2 start ecosystem.config.js
  pm2 save
  warn "De bot tu bat lai sau khi khoi dong may, chay lenh pm2 in ra khi go:  pm2 startup"
else
  say "Xong. Chay thu:  npm start   (chay nen lau dai: ./install.sh --pm2)"
fi
