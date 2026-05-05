#!/bin/bash
set -e
cd /var/www/jobpro
git pull origin main
pnpm --filter api-server build
pnpm --filter team-edit build
rsync -a --delete artifacts/team-edit/dist/public/ /var/www/jobpro-public/
pm2 restart jobpro-api --update-env
echo "Deploy concluído!"
