#!/bin/bash
# ============================================================================
# Bootstrap Script for EC2 — Run this after SSH'ing in
# ============================================================================
set -e

echo "=== Installing Nginx ==="
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx git ec2-instance-connect

echo "=== Setting up website ==="
sudo mkdir -p /var/www/staging.fin.xtend.co
sudo chown -R ubuntu:ubuntu /var/www/staging.fin.xtend.co

echo "=== Creating Nginx config ==="
sudo tee /etc/nginx/sites-available/staging.fin.xtend.co > /dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name staging.fin.xtend.co;
    root /var/www/staging.fin.xtend.co;
    index index.html;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;
    location / {
        try_files $uri $uri/ =404;
    }
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/staging.fin.xtend.co /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "=== Nginx ready! ==="
echo "Next: Copy index.html to /var/www/staging.fin.xtend.co/"
echo "Then: sudo certbot --nginx -d staging.fin.xtend.co"
