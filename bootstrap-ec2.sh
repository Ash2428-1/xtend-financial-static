#!/bin/bash
# EC2 Bootstrap Script for staging.fin.xtend.co
# Run this on a fresh Ubuntu 22.04 EC2 instance in af-south-1
# SECURITY HARDENED — Updated 2026-08-14

set -e

DOMAIN="staging.fin.xtend.co"
WWW_ROOT="/var/www/$DOMAIN"

echo "=== Updating packages ==="
sudo apt update && sudo apt upgrade -y

echo "=== Installing modern Nginx (official repo) ==="
# Ubuntu 22.04 default nginx (1.18.0) is outdated and has CVEs.
# Use the official nginx stable repo for 1.26.x.
curl -fsSL https://nginx.org/keys/nginx_signing.key | sudo gpg --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/ubuntu $(lsb_release -cs) nginx" | sudo tee /etc/apt/sources.list.d/nginx.list
sudo apt update
sudo apt install -y nginx

echo "=== Creating web root ==="
sudo mkdir -p "$WWW_ROOT"
sudo chown -R ubuntu:ubuntu "$WWW_ROOT"

echo "=== Creating hardened Nginx server block ==="
sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name staging.fin.xtend.co;

    root /var/www/staging.fin.xtend.co;
    index index.html;

    # Hide nginx version (prevents information disclosure)
    server_tokens off;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), fullscreen=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.xtend.co; frame-ancestors 'self'; base-uri 'self'; form-action 'self';" always;

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
