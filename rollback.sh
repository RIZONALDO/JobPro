#!/bin/bash
# Uso: ./rollback.sh <tag-ou-commit>
# Exemplo: ./rollback.sh v-prod-pre-tanstack
# Exemplo: ./rollback.sh 0ac7b75
set -e

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Uso: $0 <tag-ou-commit>"
  echo ""
  echo "Tags disponíveis:"
  git tag -l "v-prod-*" --sort=-version:refname
  echo ""
  echo "Últimos commits:"
  git log --oneline -10
  exit 1
fi

cd /var/www/jobpro

echo "→ Fazendo fetch de tags..."
git fetch --tags origin

echo "→ Checkout de $TARGET..."
git checkout "$TARGET"

echo "→ Buildando..."
pnpm --filter api-server build
pnpm --filter team-edit build
rsync -a --delete artifacts/team-edit/dist/public/ /var/www/jobpro-public/

echo "→ Reiniciando API..."
pm2 restart jobpro-api --update-env

echo ""
echo "✓ Rollback para $TARGET concluído!"
echo "  Para voltar ao main: ssh -p 22022 root@108.174.144.208 'bash /var/www/jobpro/deploy.sh'"
