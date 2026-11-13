#!/usr/bin/env bash
# Резервная копия базы: ./backup.sh  → backups/staxi-ГГГГ-ММ-ДД_ЧЧММ.sql.gz (хранит 30 последних).
# Для ежедневного запуска добавьте в crontab, например:
#   15 3 * * * /путь/к/папке/стека/backup.sh >/dev/null 2>&1
set -euo pipefail
cd "$(dirname "$0")"
umask 077
mkdir -p backups
file="backups/staxi-$(date +%F_%H%M).sql.gz"
docker exec staxi-db pg_dump -U postgres -d postgres --schema=public --schema=auth --no-owner | gzip > "$file"
ls -1t backups/staxi-*.sql.gz | tail -n +31 | xargs -r rm --
echo "Готово: $file"
