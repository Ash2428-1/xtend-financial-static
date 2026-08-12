#!/bin/bash
# EC2 Bootstrap Script for staging.fin.xtend.co
# Run this on a fresh Ubuntu 22.04 EC2 instance in af-south-1

set -e

DOMAIN="staging.fin.xtend.co"
WWW_ROOT="/var/www/$DOMAIN"

echo "=== Updating packages ==="
sudo apt update && sudo apt upgrade -y

echo "=== Installing Nginx ==="
sudo apt install -y nginx

echo "=== Creating web root ==="
sudo mkdir -p "$WWW_ROOT"
sudo chown -R ubuntu:ubuntu "$WWW_ROOT"

echo "=== Creating Nginx server block ==="
sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name staging.fin.xtend.co;

    root /var/www/staging.fin.xtend.co;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    location / {
        try_files $uri $uri/ =404;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

echo "=== Enabling site ==="
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

echo "=== Testing Nginx config ==="
sudo nginx -t

echo "=== Starting Nginx ==="
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "=== Installing Certbot for SSL ==="
sudo apt install -y certbot python3-certbot-nginx

echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Point DNS A-record for staging.fin.xtend.co to this EC2 IP"
echo "2. Run: sudo certbot --nginx -d staging.fin.xtend.co"
echo "3. Add GitHub Actions secrets: EC2_HOST, EC2_USER, EC2_SSH_KEY"
echo ""
echo "Web root: $WWW_ROOT"
echo "Nginx config: /etc/nginx/sites-available/$DOMAIN"
