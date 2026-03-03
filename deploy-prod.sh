#!/bin/bash

echo "🚀 BACKEND PROD DEPLOY STARTED: $(date)"

cd /var/www/backend-prod || exit 1

echo "📦 Fetching latest code..."
git fetch origin

echo "🧹 Resetting to origin/main (safe mode)"
git reset --hard origin/main

# ❗ IMPORTANT: uploads & .env ko delete hone se bachao
git clean -fd -e uploads/ -e .env -e firebase/

echo "📦 Installing production dependencies..."
npm install --production

echo "🔄 Restarting PM2 app..."
pm2 restart backend-prod --update-env

echo "💾 Saving PM2 state..."
pm2 save

echo "✅ BACKEND PROD DEPLOY COMPLETED: $(date)"

