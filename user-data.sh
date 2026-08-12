#!/bin/bash
# ============================================================================
# User Data Script — Runs automatically on first boot
# Sets up Nginx, deploys website, installs EC2 Instance Connect
# ============================================================================

exec > /var/log/user-data.log 2>&1
set -x

echo "=== Starting setup at $(date) ==="

# Update packages
apt-get update
apt-get install -y nginx git ec2-instance-connect

# Create web root
mkdir -p /var/www/staging.fin.xtend.co
chown -R ubuntu:ubuntu /var/www/staging.fin.xtend.co

# Create Nginx config
cat > /etc/nginx/sites-available/staging.fin.xtend.co <<'NGINX_EOF'
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
NGINX_EOF

# Enable site
ln -sf /etc/nginx/sites-available/staging.fin.xtend.co /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload nginx
nginx -t && systemctl enable nginx && systemctl restart nginx

# Install Certbot
apt-get install -y certbot python3-certbot-nginx

# Clone repo and deploy (repo should be public)
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
