#!/bin/bash
set -e

echo "🔍 Diagnosing container crash..."
cd /opt/trading-bot

# Start container and capture logs immediately
echo "▶️  Starting container..."
sudo /usr/local/bin/docker-compose up -d

# Follow logs for 15 seconds to catch crash
echo "📋 Capturing logs (15 seconds)..."
timeout 15 sudo docker logs -f trading-bot 2>&1 || true

echo ""
echo "📊 Final container status:"
sudo docker ps -a --filter name=trading-bot --format "table {{.ID}}\t{{.Status}}\t{{.Names}}"

echo ""
echo "💾 Checking memory usage:"
free -h

echo ""
echo "🐳 Docker inspect (exit code):"
sudo docker inspect trading-bot --format='{{.State.ExitCode}} - {{.State.Error}}' 2>&1 || echo "Container doesn't exist"

echo ""
echo "📜 Full docker-compose logs:"
sudo /usr/local/bin/docker-compose logs --tail=100
