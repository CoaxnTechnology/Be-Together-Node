#!/bin/bash

echo "🚀 PROD DEPLOY STARTED"

cd /var/www/backend-prod || exit

git checkout main
git pull origin main

npm install --production

pm2 restart backend-prod

echo "✅ PROD DEPLOY COMPLETED"
