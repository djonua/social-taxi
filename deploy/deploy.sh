#!/usr/bin/env bash
# Выкладка на сервер: боевой стек, демо-стек, миграции БД, серверная функция, сайт и APK.
# Запускать с рабочего компьютера из любой папки:  ./deploy/deploy.sh
# Повторный запуск безопасен: секреты и данные не перезаписываются.
#   STAXI_SKIP_DEMO=1 ./deploy/deploy.sh   — не трогать демо-стек
#
# Куда выкладывать — в файле deploy/deploy.local (в git не хранится,
# образец — deploy/deploy.local.example) или в одноимённых переменных окружения.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/deploy/deploy.local" ]; then
  # Переменные окружения важнее файла.
  while IFS='=' read -r name value; do
    case "$name" in
      STAXI_HOST|STAXI_DIR|STAXI_DEMO_DIR|STAXI_DOMAIN)
        [ -n "${!name:-}" ] || export "$name=$value" ;;
    esac
  done < "$ROOT/deploy/deploy.local"
fi

HOST="${STAXI_HOST:?Укажите STAXI_HOST (см. deploy/deploy.local.example)}"
DIR="${STAXI_DIR:?Укажите STAXI_DIR (см. deploy/deploy.local.example)}"
DOMAIN="${STAXI_DOMAIN:?Укажите STAXI_DOMAIN (см. deploy/deploy.local.example)}"
DEMO_DIR="${STAXI_DEMO_DIR:-$DIR-demo}"

# Применяет ещё не применённые миграции из <папка>/migrations в базу контейнера.
migrate() { # $1 — контейнер БД, $2 — папка стека на сервере
  ssh "$HOST" "cd '$2' && DB='$1' bash -s" <<'REMOTE'
set -euo pipefail
for i in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$DB" 2>/dev/null </dev/null)" = healthy ] && break
  [ "$i" = 60 ] && { echo "БД $DB не поднялась"; exit 1; }
  sleep 2
done
# </dev/null обязателен: иначе docker exec -i «съест» остаток этого скрипта со stdin.
psql() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql -c "create schema if not exists internal; create table if not exists internal.migrations (name text primary key, applied_at timestamptz not null default now());" </dev/null 2>/dev/null
for f in $(ls migrations/*.sql | sort); do
  name=$(basename "$f")
  if [ "$(psql -Atc "select 1 from internal.migrations where name = '$name'" </dev/null)" = "1" ]; then
    continue
  fi
  echo "  применяю $name"
  psql -1 < "$f"
  psql -c "insert into internal.migrations (name) values ('$name')" </dev/null
done
psql -c "notify pgrst, 'reload schema'" </dev/null
REMOTE
}

# ───────────── Боевой стек ─────────────
echo "▸ Боевой стек → $HOST:$DIR"
ssh "$HOST" "mkdir -p '$DIR/site' '$DIR/migrations' '$DIR/volumes/functions/admin-users'"
rsync -az --exclude '.env' --exclude 'site' --exclude 'backups' --exclude 'migrations' \
  --exclude 'volumes/db/data' --exclude 'deploy.sh' --exclude 'deploy.local*' \
  --exclude 'docker-compose.demo.yml' \
  "$ROOT/deploy/" "$HOST:$DIR/"
rsync -az --delete "$ROOT/supabase/functions/admin-users/" "$HOST:$DIR/volumes/functions/admin-users/"
rsync -az --delete "$ROOT/supabase/migrations/" "$HOST:$DIR/migrations/"
ssh "$HOST" "cd '$DIR' && chmod +x gen-env.sh backup.sh volumes/api/kong-entrypoint.sh && ./gen-env.sh '$DOMAIN' && docker compose up -d --remove-orphans 2>&1 | grep -vE 'Running|Healthy|Waiting' || true"
migrate staxi-db "$DIR"
ssh "$HOST" "docker restart staxi-functions >/dev/null"

# ───────────── Демо-стек (отдельная база с вымышленными данными) ─────────────
DEMO_ANON_KEY=""
if [ -z "${STAXI_SKIP_DEMO:-}" ]; then
  echo "▸ Демо-стек → $HOST:$DEMO_DIR"
  ssh "$HOST" "mkdir -p '$DEMO_DIR/migrations' '$DEMO_DIR/demo' '$DEMO_DIR/volumes/api' '$DEMO_DIR/volumes/db'"
  rsync -az "$ROOT/deploy/docker-compose.demo.yml" "$HOST:$DEMO_DIR/docker-compose.yml"
  rsync -az "$ROOT/deploy/gen-env.sh" "$HOST:$DEMO_DIR/"
  rsync -az "$ROOT"/deploy/volumes/db/*.sql "$HOST:$DEMO_DIR/volumes/db/"
  rsync -az "$ROOT/deploy/volumes/api/kong-entrypoint.sh" "$HOST:$DEMO_DIR/volumes/api/"
  # У демо свой контейнер Realtime — подставляем его имя в конфигурацию шлюза.
  # Файл заменяем, только если он изменился (иначе контейнер держит старую копию).
  sed 's/realtime-dev\.staxi-realtime/realtime-dev.staxi-demo-realtime/g' "$ROOT/deploy/volumes/api/kong.yml" \
    | ssh "$HOST" "cd '$DEMO_DIR/volumes/api' && cat > kong.yml.new && if cmp -s kong.yml.new kong.yml; then rm kong.yml.new; else mv kong.yml.new kong.yml; fi"
  rsync -az --delete "$ROOT/supabase/migrations/" "$HOST:$DEMO_DIR/migrations/"
  rsync -az --delete "$ROOT/supabase/demo/" "$HOST:$DEMO_DIR/demo/"
  ssh "$HOST" "cd '$DEMO_DIR' && chmod +x gen-env.sh volumes/api/kong-entrypoint.sh && ./gen-env.sh '$DOMAIN' && docker compose up -d --remove-orphans 2>&1 | grep -vE 'Running|Healthy|Waiting' || true"
  migrate staxi-demo-db "$DEMO_DIR"
  echo "  демо-скрипт (данные и «оживление»)"
  ssh "$HOST" "docker exec -i staxi-demo-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < '$DEMO_DIR/demo/demo.sql' >/dev/null"
  DEMO_ANON_KEY="$(ssh "$HOST" "grep '^ANON_KEY=' '$DEMO_DIR/.env' | cut -d= -f2-")"
  # Демо-пользователи и первая загрузка данных (если их ещё нет).
  if [ "$(ssh "$HOST" "docker exec staxi-demo-db psql -U postgres -d postgres -Atc 'select count(*) from public.profiles' </dev/null")" = "0" ]; then
    echo "  создаю демо-пользователей"
    sleep 8 # шлюзу нужно несколько секунд после первого запуска
    (cd "$ROOT/web" && SUPABASE_URL="https://$DOMAIN/demo" \
      SUPABASE_SERVICE_ROLE_KEY="$(ssh "$HOST" "grep '^SERVICE_ROLE_KEY=' '$DEMO_DIR/.env' | cut -d= -f2-")" \
      node scripts/seed.mjs --demo)
  fi
fi

# ───────────── Сайт ─────────────
echo "▸ Сборка сайта"
ANON_KEY="$(ssh "$HOST" "grep '^ANON_KEY=' '$DIR/.env' | cut -d= -f2-")"
(
  cd "$ROOT/web"
  export VITE_SUPABASE_URL="https://$DOMAIN" VITE_SUPABASE_ANON_KEY="$ANON_KEY"
  if [ -n "$DEMO_ANON_KEY" ]; then
    export VITE_DEMO_SUPABASE_URL="https://$DOMAIN/demo" VITE_DEMO_SUPABASE_ANON_KEY="$DEMO_ANON_KEY"
  else
    export VITE_DEMO_SUPABASE_URL="" VITE_DEMO_SUPABASE_ANON_KEY=""
  fi
  pnpm build >/dev/null
)
rsync -az --delete --exclude 'app' "$ROOT/web/dist/" "$HOST:$DIR/site/"
# nginx.conf подключён как отдельный файл — контейнер видит новую версию только после перезапуска.
ssh "$HOST" "docker restart staxi-site >/dev/null"

# ───────────── Приложение водителя ─────────────
APK="$ROOT/driver_app/build/app/outputs/flutter-apk/app-release.apk"
if [ -f "$APK" ]; then
  echo "▸ Приложение водителя → https://$DOMAIN/app/soctaxi-driver.apk"
  ssh "$HOST" "mkdir -p '$DIR/site/app'"
  rsync -az "$APK" "$HOST:$DIR/site/app/soctaxi-driver.apk"
fi

echo "✓ Готово: https://$DOMAIN"
