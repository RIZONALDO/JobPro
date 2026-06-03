#!/bin/bash
set -e
cd /var/www/jobpro
git fetch --tags origin
git pull origin main

# Marca a versão que entrou em produção (facilita rollback)
COMMIT=$(git rev-parse --short HEAD)
DATE=$(date +%Y-%m-%d)
git tag -f "v-prod-${DATE}" HEAD 2>/dev/null || true

pnpm --filter api-server build
pnpm --filter team-edit build
rsync -a --delete artifacts/team-edit/dist/public/ /var/www/jobpro-public/
pm2 restart jobpro-api --update-env
echo "Deploy concluído! Versão: $COMMIT (tag: v-prod-${DATE})"
