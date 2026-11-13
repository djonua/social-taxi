#!/usr/bin/env bash
# Создаёт .env с новыми секретами (один раз, на сервере). Существующий .env не трогает.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo ".env уже существует — ничего не меняю."
  exit 0
fi

DOMAIN="${1:?Укажите домен: ./gen-env.sh staxi.example.ru}"
umask 077

rand() { openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

POSTGRES_PASSWORD=$(rand 32)
JWT_SECRET=$(rand 48)
SECRET_KEY_BASE=$(rand 64)
DASHBOARD_PASSWORD=$(rand 32)

jwt() {
  python3 - "$JWT_SECRET" "$1" <<'PY'
import sys, json, hmac, hashlib, base64, time
secret, role = sys.argv[1], sys.argv[2]
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
now = int(time.time())
head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
body = b64(json.dumps({"role": role, "iss": "supabase", "iat": now, "exp": now + 10 * 365 * 86400}, separators=(",", ":")).encode())
sig = b64(hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
print(f"{head}.{body}.{sig}")
PY
}

cat > .env <<EOF
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
ANON_KEY=$(jwt anon)
SERVICE_ROLE_KEY=$(jwt service_role)
SECRET_KEY_BASE=$SECRET_KEY_BASE
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
EOF

echo ".env создан (доступ только владельцу)."
