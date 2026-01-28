#!/bin/bash
#!/bin/bash
echo "DEPLOY FILE: $(realpath $0)" >> /tmp/deploy-proof.log
set -e

echo "🚀 Deploy started at $(date)"

cd /var/www/backend-uat || exit 1

echo "📦 Fetching latest code..."
git fetch origin

echo "🧹 Resetting to origin/testing"
git reset --hard origin/testing
git clean -fd -e uploads/ -e .env


echo "📦 Installing dependencies"
npm install --production

echo "🔄 Restarting PM2 app"
pm2 restart backend-uat --update-env

echo "💾 Saving PM2 state"
pm2 save

echo "✅ Deploy finished at $(date)"
