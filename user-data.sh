#!/bin/bash
# ============================================================================
# User Data Script — Runs automatically on first boot
# Sets up Nginx, deploys website, installs EC2 Instance Connect
# SECURITY HARDENED — Updated 2026-08-14
# ============================================================================

exec > /var/log/user-data.log 2>&1
set -x

echo "=== Starting setup at $(date) ==="

# Update packages
apt-get update

# Install modern Nginx (official repo) instead of outdated Ubuntu default
curl -fsSL https://nginx.org/keys/nginx_signing.key | gpg --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/ubuntu $(lsb_release -cs) nginx" | tee /etc/apt/sources.list.d/nginx.list
apt-get update
apt-get install -y nginx git ec2-instance-connect

# Create web root
mkdir -p /var/www/staging.fin.xtend.co
chown -R ubuntu:ubuntu /var/www/staging.fin.xtend.co

# Create hardened Nginx config
cat > /etc/nginx/sites-available/staging.fin.xtend.co <<'NGINX_EOF'
server {
    listen 80;
    listen [::]:80;
    server_name staging.fin.xtend.co;
    root /var/www/staging.fin.xtend.co;
    index index.html;

    # Hide nginx version
    server_tokens off;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), fullscreen=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.xtend.co; frame-ancestors 'self'; base-uri 'self'; form-action 'self';" always;

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
NGINX_EOF

# Enable site
ln -sf /etc/nginx/sites-available/staging.fin.xtend.co /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Create generic error pages (prevent version leak)
mkdir -p /var/www/html
cat > /var/www/html/404.html <<'ERR_EOF'
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Page Not Found</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;margin:0}
h1{font-size:6rem;color:#38bdf8;margin-bottom:.5rem}p{color:#94a3b8}</style></head>
<body><div><h1>404</h1><p>The page you are looking for does not exist.</p></div></body></html>
ERR_EOF
cp /var/www/html/404.html /var/www/html/50x.html

# Test and reload nginx
nginx -t && systemctl enable nginx && systemctl restart nginx

# Install Certbot
apt-get install -y certbot python3-certbot-nginx

# Clone repo and deploy
cd /var/www/staging.fin.xtend.co
if git clone https://github.com/Ash2428-1/xtend-financial-static.git temp 2>/dev/null; then
    mv temp/index.html .
    rm -rf temp
    chown -R www-data:www-data /var/www/staging.fin.xtend.co
    echo "=== Website deployed successfully ==="
else
    echo "=== WARNING: Could not clone repo. Place index.html manually ==="
fi

echo "=== Setup complete at $(date) ==="
echo "Next: Run 'sudo certbot --nginx -d staging.fin.xtend.co' to enable SSL"
