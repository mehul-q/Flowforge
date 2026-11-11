#!/bin/bash
# Deploy FlowForge to a fresh Ubuntu 22.04 EC2 instance.
# Usage: ./deploy.sh <ec2-public-ip> <path-to-key.pem>

set -e
IP="$1"
KEY="$2"
if [ -z "$IP" ] || [ -z "$KEY" ]; then
  echo "usage: $0 <ec2-ip> <path-to-key.pem>"
  exit 1
fi

echo "==> Copying project to EC2"
rsync -az --exclude node_modules --exclude dist --exclude .git \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  ./ ubuntu@$IP:/home/ubuntu/flowforge/

echo "==> Installing Docker and starting the stack"
ssh -i "$KEY" -o StrictHostKeyChecking=no ubuntu@$IP <<'EOF'
  set -e
  if ! command -v docker &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y docker.io docker-compose-v2
    sudo usermod -aG docker ubuntu
  fi
  cd /home/ubuntu/flowforge
  sudo docker compose up --build -d
EOF

echo "==> Done. API should be at http://$IP:3000/health"