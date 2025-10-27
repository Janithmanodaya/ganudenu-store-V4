#!/usr/bin/env bash
set -euo pipefail

# 1) Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
  echo "node_modules not found. Installing dependencies..."
  npm install
fi

# 2) Export environment variables (placeholders)
export __app_id="your_app_id_placeholder"
export __firebase_config='{"apiKey":"YOUR_API_KEY","authDomain":"your-app.firebaseapp.com","projectId":"your-project-id","storageBucket":"your-app.appspot.com","messagingSenderId":"1234567890","appId":"1:1234567890:web:abcdef123456"}'
export __initial_auth_token="your_initial_auth_token_placeholder"
export GEMINI_API_KEY="your_gemini_api_key_placeholder"

# 3) Start backend server (port 5174) in background
echo "Starting backend server at http://localhost:5174 ..."
node server/index.js &

# 4) Start Vite dev server (port 5173)
echo "Starting frontend dev server at http://localhost:5173 ..."
npm run dev