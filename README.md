# Xtend Financial — Unit Economics Dashboard

A self-contained financial dashboard deployed on AWS EC2 in South Africa (`af-south-1`).

## What's This?

A static HTML file (the Unit Economics Dashboard) served by Nginx on an EC2 instance. No build step, no Docker, no backend — just a fast, simple static site.

## Tech Stack

- **Frontend:** Single self-contained HTML file with inline CSS/JS
- **Server:** Nginx on Ubuntu 22.04
- **Hosting:** AWS EC2 `t3.micro` in `af-south-1` (Cape Town)
- **SSL:** Let's Encrypt (Certbot)
- **CI/CD:** GitHub Actions → SCP to EC2

## Domain

`https://staging.fin.xtend.co`

## Deployment

Every push to `main` automatically deploys `index.html` to EC2 via GitHub Actions.

## Manual Deploy

If you need to deploy manually:

```bash
# From your local machine
scp -i ~/.ssh/your-key.pem index.html ubuntu@<EC2_IP>:/var/www/staging.fin.xtend.co/
ssh -i ~/.ssh/your-key.pem ubuntu@<EC2_IP> "sudo systemctl reload nginx"
```

## EC2 Setup (One-Time)

1. Launch Ubuntu 22.04 EC2 in `af-south-1`
2. SSH in and run the bootstrap script (see `bootstrap-ec2.sh`)
3. Configure DNS A-record → EC2 public IP
4. Run Certbot for SSL
5. Add GitHub Actions secrets

See full instructions in the bootstrap script.

---

**Data residency:** All files and traffic stay within AWS South Africa.
