# Home Grown Creations - Hostinger Deployment Guide

## Prerequisites

- Hostinger Business or higher hosting plan
- Domain configured and pointing to Hostinger
- SSH access enabled in hPanel
- MySQL database created

---

## Step 1: Database Setup

### 1.1 Create MySQL Database in hPanel

1. Log into Hostinger hPanel
2. Go to **Databases** → **MySQL Databases**
3. Create a new database:
   - Database name: `u123456789_hgc` (will be prefixed with your account)
   - Username: `u123456789_hgcuser`
   - Password: Generate a strong password (save this!)
4. Note down the credentials

### 1.2 Database Host

For Hostinger, use:
- **Host**: `localhost` (if Node.js runs on same server)
- **Port**: `3306`

---

## Step 2: Node.js Setup on Hostinger

### 2.1 Access Your Server

```bash
ssh u123456789@your-ip-address
```

### 2.2 Install Node.js (if not pre-installed)

```bash
# Check if Node.js is installed
node -v

# If not, use nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

### 2.3 Install PM2 (Process Manager)

```bash
npm install -g pm2
```

---

## Step 3: Deploy Application

### 3.1 Upload Files

Option A: Using Git
```bash
cd ~
git clone https://github.com/YOUR-USERNAME/hgc.git
cd hgc
```

Option B: Using SFTP
- Upload all files to `/home/u123456789/hgc/`

### 3.2 Install Dependencies

```bash
# Install frontend dependencies
cd ~/hgc
npm install

# Install backend dependencies
cd ~/hgc/server
npm install
```

### 3.3 Configure Environment

```bash
cd ~/hgc/server

# Copy the production template
cp .env.production.example .env

# Edit with your actual values
nano .env
```

**CRITICAL: Fill in all values in .env file!**

Generate secure secrets:
```bash
# Generate JWT_SECRET (64 chars)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate SESSION_SECRET (32 chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate ENCRYPTION_KEY (32 chars)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 3.4 Initialize Database

```bash
cd ~/hgc/server
npm run db:init
```

This will:
- Create all database tables
- Seed initial data (categories, products, admin user)
- Create default settings

### 3.5 Build Frontend

```bash
cd ~/hgc
npm run build
```

---

## Step 4: Start Application

### 4.1 Using PM2 (Recommended)

Create ecosystem file:
```bash
cat > ~/hgc/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'hgc-backend',
    cwd: './server',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '500M'
  }]
};
EOF
```

Start the application:
```bash
cd ~/hgc
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 4.2 Verify Running

```bash
pm2 status
pm2 logs hgc-backend
```

---

## Step 5: Configure Reverse Proxy (Nginx)

### 5.1 Nginx Configuration

Create or edit nginx config:
```nginx
server {
    listen 80;
    server_name homegrowncreations.thepfps.xyz;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name homegrowncreations.thepfps.xyz;

    # SSL certificates (Hostinger provides these)
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;

    # Frontend (static files)
    root /home/u123456789/hgc/dist;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Uploads
    location /uploads/ {
        alias /home/u123456789/hgc/server/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Frontend routing (SPA)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

### 5.2 Restart Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 6: PayPal Configuration

### 6.1 Create PayPal Business Account

1. Go to [PayPal Developer](https://developer.paypal.com)
2. Create a **Live** application
3. Get your Live Client ID and Secret
4. Update `.env` with live credentials

### 6.2 Configure PayPal Webhooks

1. In PayPal Developer Dashboard, go to your app
2. Add webhook URL: `https://homegrowncreations.thepfps.xyz/api/v1/webhooks/paypal`
3. Subscribe to events:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.DENIED`
   - `PAYMENT.CAPTURE.REFUNDED`
4. Copy the Webhook ID to your `.env`

---

## Step 7: Post-Deployment Checklist

### Security Checklist

- [ ] Changed default admin password
- [ ] All secrets are unique and secure
- [ ] HTTPS is working correctly
- [ ] PayPal is in live mode
- [ ] Email sending works
- [ ] Rate limiting is active
- [ ] Logs are being created

### Test Checklist

- [ ] Homepage loads correctly
- [ ] Products display properly
- [ ] User registration works
- [ ] Login/logout works
- [ ] Add to cart works
- [ ] Checkout with PayPal works
- [ ] Order confirmation email received
- [ ] Admin panel accessible
- [ ] Admin can view/edit products

---

## Step 8: First Login

1. Go to `https://homegrowncreations.thepfps.xyz/admin`
2. Login with default credentials:
   - Email: `admin@homegrowncreations.com`
   - Password: `Admin123!@#`
3. **IMMEDIATELY change the password!**
4. Enable two-factor authentication for admin account

---

## Maintenance Commands

### View Logs
```bash
pm2 logs hgc-backend
tail -f ~/hgc/server/logs/application-*.log
```

### Restart Application
```bash
pm2 restart hgc-backend
```

### Update Application
```bash
cd ~/hgc
git pull
npm install
cd server && npm install
pm2 restart hgc-backend
```

### Database Backup
```bash
mysqldump -u u123456789_hgcuser -p u123456789_hgc > backup_$(date +%Y%m%d).sql
```

---

## Troubleshooting

### Application Won't Start

1. Check logs: `pm2 logs hgc-backend`
2. Verify `.env` file exists and has correct values
3. Check database connection: `mysql -u user -p -h localhost database_name`

### Database Connection Failed

1. Verify credentials in `.env`
2. Ensure MySQL is running: `systemctl status mysql`
3. Check if user has permissions on database

### PayPal Not Working

1. Verify live credentials (not sandbox)
2. Check webhook configuration
3. Ensure SSL certificate is valid

### Emails Not Sending

1. Test SMTP credentials manually
2. Check spam folder
3. Verify Hostinger email is set up correctly

---

## Support

For issues, check:
- Application logs: `~/hgc/server/logs/`
- PM2 logs: `pm2 logs`
- Nginx logs: `/var/log/nginx/`
