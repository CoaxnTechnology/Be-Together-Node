#!/bin/bash
set -e

echo "🚀 Deploy started at $(date)"

cd /var/www/testing/api

echo "📦 Fetching latest code..."
git fetch origin

echo "🔀 Checkout testing branch"
git checkout testing

echo "⬇️ Pulling latest changes"
git pull origin testing

echo "📦 Installing dependencies"
npm install --production

echo "🔄 Restarting PM2 app"
pm2 reload uat-api --update-env

echo "💾 Saving PM2 state"
pm2 save

echo "✅ Deploy finished at $(date)"
// End of deploy.sh
