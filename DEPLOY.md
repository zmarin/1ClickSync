# 1ClickSync — Deployment Guide (Dokploy + Hetzner)

## Prerequisites

- Hetzner CCX33 (16 vCPU, 32GB RAM) or similar
- Dokploy installed on the server
- Domain pointed to server IP (e.g. app.1clicksync.com)
- Zoho developer account at https://api-console.zoho.com

---

## Step 1: Zoho OAuth App Registration

1. Go to https://api-console.zoho.com
2. Click "Add Client" → choose "Server-based Applications"
3. Fill in:
   - **Client Name**: 1ClickSync
   - **Homepage URL**: https://app.1clicksync.com
   - **Authorized Redirect URI**: https://app.1clicksync.com/api/auth/zoho/callback
4. Note down the **Client ID** and **Client Secret**

**Important:** If you want to support customers on multiple Zoho datacenters
(EU, IN, AU, JP), you may need to register the app on each DC's developer
console. Start with your own DC first.

---

## Step 2: Server Setup

SSH into your Hetzner box:

```bash
ssh root@your-server-ip
```

### Install Dokploy (if not done)

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Access Dokploy UI at `https://your-server-ip:3000` and complete initial setup.

### Point your domain

Add an A record:
```
app.1clicksync.com → your-server-ip
```

Wait for DNS propagation (usually 5-15 minutes).

---

## Step 3: Deploy via Dokploy

### Option A: Git Push Deploy (recommended)

1. In Dokploy UI, create a new **Compose** project
2. Connect your Git repo (GitHub/GitLab)
3. Set the compose file path to `docker-compose.yml`
4. Dokploy will auto-deploy on every push to main

### Option B: Manual Compose Deploy

1. In Dokploy UI, create a new **Compose** project
2. Paste the contents of `docker-compose.yml`
3. Deploy manually from the UI

### Configure Environment Variables

In Dokploy project settings → Environment Variables, add all vars from `.env.example`:

```bash
# Generate encryption key
openssl rand -hex 32

# Generate session secret
openssl rand -hex 16

# Generate DB password
openssl rand -base64 24
```

### Configure SSL

In Dokploy → Project → Domains:
1. Add `app.1clicksync.com`
2. Map to service `app`, port `3000`
3. Enable HTTPS (Let's Encrypt auto-provisions)

---

## Step 4: Verify Deployment

```bash
# Health check
curl https://app.1clicksync.com/health

# Should return:
# {"status":"ok","timestamp":"2025-..."}
```

Check logs in Dokploy UI:
- `app` service: API server logs
- `worker` service: Job processing logs
- `postgres` service: Database logs

---

## Step 5: First Customer Test

Use your own Zoho One account to test the full flow:

```bash
# 1. Create a test customer
curl -X POST https://app.1clicksync.com/api/customers \
  -H "Content-Type: application/json" \
  -d '{
    "email": "you@yourdomain.com",
    "site_name": "MyTestApp",
    "site_url": "https://mytestapp.com",
    "business_type": "saas"
  }'
# Note the returned customer id

# 2. Start OAuth flow — open in browser:
# https://app.1clicksync.com/api/auth/zoho?customer_id=YOUR_CUSTOMER_ID

# 3. After authorizing, check connection:
curl https://app.1clicksync.com/api/connection/YOUR_CUSTOMER_ID

# 4. Trigger setup:
curl -X POST https://app.1clicksync.com/api/setup/start \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "YOUR_CUSTOMER_ID",
    "template_id": "saas-crm-quickstart"
  }'
# Note the returned job_id

# 5. Poll status:
curl https://app.1clicksync.com/api/setup/status/YOUR_JOB_ID
```

---

## Resource Allocation (16 vCPU / 32GB RAM)

| Service  | CPUs | RAM  | Notes                              |
|----------|------|------|------------------------------------|
| app      | 4    | 2GB  | API server, handles OAuth + REST   |
| worker   | 6    | 2GB  | Job processing, Zoho API calls     |
| postgres | 3    | 4GB  | Main database                      |
| redis    | 2    | 1GB  | Queue state, rate limiting         |
| OS/other | 1    | 1GB  | System overhead                    |
| **Free** | 0    | 22GB | Room for growth, dashboard, etc.   |

This leaves massive headroom. You could serve hundreds of customers before
needing to tune anything.

---

## Backups

### PostgreSQL

Add a cron job on the host (outside Docker):

```bash
# /etc/cron.d/1clicksync-backup
0 3 * * * root docker exec 1clicksync-postgres-1 \
  pg_dump -U oneclicksync oneclicksync | gzip > /backups/zoho-$(date +\%Y\%m\%d).sql.gz

# Keep last 30 days
0 4 * * * root find /backups -name "zoho-*.sql.gz" -mtime +30 -delete
```

### Optional: S3 offsite

```bash
# Install rclone on the host, configure with Hetzner Storage Box or S3
0 5 * * * root rclone copy /backups remote:zoho-backups/ --max-age 1d
```

---

## Monitoring

### Basic: Dokploy built-in

Dokploy shows container health, logs, and resource usage out of the box.

### Recommended: Add uptime monitoring

Use a free service like Uptime Robot or Betterstack:
- Monitor `https://app.1clicksync.com/health`
- Alert on downtime via email/Slack

### Database monitoring query

```sql
-- Check recent job success rate
SELECT
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct
FROM setup_jobs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY status;

-- Check for stuck jobs
SELECT * FROM setup_jobs
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '30 minutes';

-- Token health
SELECT
  COUNT(*) FILTER (WHERE is_valid) as healthy,
  COUNT(*) FILTER (WHERE NOT is_valid) as broken,
  COUNT(*) FILTER (WHERE token_expires_at < NOW() + INTERVAL '10 minutes') as expiring_soon
FROM zoho_tokens;
```

---

## Scaling Notes

At your current setup (16 vCPU Hetzner), you won't need to scale for a long
time. But when you do:

1. **More customers running setups simultaneously**: Increase worker concurrency
   from 5 to 10-15. The bottleneck is Zoho's per-org rate limit, not your server.

2. **More templates / more steps**: Add more worker replicas in docker-compose:
   ```yaml
   worker:
     deploy:
       replicas: 3
   ```

3. **Dashboard traffic**: The API server is stateless — just add replicas
   behind Dokploy's Traefik load balancer.

4. **Database growth**: The audit log table grows fastest. Add a cleanup job:
   ```sql
   DELETE FROM api_audit_log WHERE created_at < NOW() - INTERVAL '90 days';
   ```
