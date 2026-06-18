# 🚀 Urban HairPlaza — AWS Amplify Deployment Guide

This guide deploys Urban HairPlaza as a **two-component stack** on AWS:

| Component | AWS Service | Description |
|-----------|-------------|-------------|
| **Frontend** | AWS Amplify Hosting | Static HTML/CSS/JS served via CloudFront CDN |
| **Backend API** | AWS Lambda + API Gateway | Express.js app wrapped with `serverless-http` |

---

## 📋 Prerequisites

Install these tools before starting:

```bash
# AWS CLI (v2)
# Download: https://aws.amazon.com/cli/
aws --version   # aws-cli/2.x.x

# AWS SAM CLI
# Download: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
sam --version   # SAM CLI, version 1.x.x

# Node.js 22+
node --version  # v22.x.x
```

### Configure AWS credentials:
```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region (e.g. ap-south-1), Output format (json)
```

---

## 🔧 Step 1 — Deploy the Backend (Lambda + API Gateway)

### 1.1 Install dependencies
```bash
cd urban-hairplaza
npm install
```

### 1.2 Build the SAM package
```bash
sam build
```

This bundles your Node.js code and dependencies into `.aws-sam/build/`.

### 1.3 Deploy to AWS
```bash
sam deploy --guided
```

Answer the prompts:
| Prompt | Suggested Value |
|--------|----------------|
| Stack Name | `urban-hairplaza` |
| AWS Region | `ap-south-1` (Mumbai) or your preferred region |
| Parameter JwtSecret | Any random 64-char string (e.g. `openssl rand -hex 32`) |
| Parameter CorsOrigin | `*` (update after Amplify gives you the URL) |
| Confirm changes | `Y` |
| Allow SAM to create IAM roles | `Y` |
| Save arguments to config file | `Y` (saves `samconfig.toml`) |

### 1.4 Note the API Gateway URL
After deployment completes, the terminal shows:
```
Outputs:
  ApiUrl = https://abc123xyz.execute-api.ap-south-1.amazonaws.com/prod
```

**Copy this URL** — you'll need it in Step 3.

### Subsequent deployments (CI):
```bash
sam build && sam deploy --no-confirm-changeset
```

---

## 🌐 Step 2 — Deploy the Frontend (Amplify Hosting)

### 2.1 Open AWS Amplify Console
Go to → **https://console.aws.amazon.com/amplify/**

### 2.2 Create a new app
1. Click **"New app"** → **"Host web app"**
2. Choose **GitHub** as the source
3. Authorize Amplify to access your GitHub account
4. Select repository: **`Vishwajit-creater/urban-hairplaza`**
5. Select branch: **`main`**

### 2.3 Configure build settings
Amplify auto-detects the `amplify.yml` file. Verify it shows:
- **Base directory**: `frontend`
- **Build command**: _(auto from amplify.yml)_

### 2.4 Add environment variables
In **"Advanced settings"** → **"Environment variables"**, add:

| Key | Value |
|-----|-------|
| `API_GATEWAY_URL` | `https://abc123xyz.execute-api.ap-south-1.amazonaws.com/prod` |
| `NODE_ENV` | `production` |

### 2.5 Save and deploy
Click **"Save and deploy"**. Amplify runs your build and publishes the site.

**Your Amplify URL** will be something like:
```
https://main.d1abc2def3ghi.amplifyapp.com
```

---

## 🔁 Step 3 — Connect Frontend ↔ Backend (Rewrites & Redirects)

This is the **critical step** that routes `/api/*` requests from the frontend to your Lambda function.

### 3.1 Open Rewrites and Redirects
In the Amplify Console → your app → **"Rewrites and redirects"** → **"Manage redirects"**

### 3.2 Add these rules (in this exact order):

| Source address | Target address | Type |
|----------------|---------------|------|
| `/api/<*>` | `https://abc123xyz.execute-api.ap-south-1.amazonaws.com/prod/api/<*>` | **200 (Rewrite)** |
| `/customer` | `/customer/index.html` | 200 (Rewrite) |
| `/customer/<*>` | `/customer/index.html` | 200 (Rewrite) |
| `/owner` | `/owner/index.html` | 200 (Rewrite) |
| `/owner/<*>` | `/owner/index.html` | 200 (Rewrite) |
| `/admin` | `/admin/index.html` | 200 (Rewrite) |
| `/admin/<*>` | `/admin/index.html` | 200 (Rewrite) |
| `/<*>` | `/customer/index.html` | 200 (Rewrite) |

> ⚠️ **Replace** `abc123xyz.execute-api.ap-south-1.amazonaws.com/prod` with your actual API Gateway URL from Step 1.4.

### 3.3 Update CORS origin
Go back to the SAM deployment and update the CorsOrigin parameter:
```bash
sam deploy \
  --parameter-overrides \
    JwtSecret=your-jwt-secret-here \
    CorsOrigin=https://main.d1abc2def3ghi.amplifyapp.com \
  --no-confirm-changeset
```

### 3.4 Add custom domain (optional)
In Amplify → **"Domain management"** → **"Add domain"** — follow the wizard.

---

## ✅ Step 4 — Verify Deployment

### Test the API:
```bash
# Should return 3 salons
curl https://main.d1abc2def3ghi.amplifyapp.com/api/salons

# Should return a JWT
curl -X POST https://main.d1abc2def3ghi.amplifyapp.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@uhp.com","password":"Admin@123"}'
```

### Open the portals:
- **Customer** → `https://main.d1abc2def3ghi.amplifyapp.com/customer`
- **Owner** → `https://main.d1abc2def3ghi.amplifyapp.com/owner`
- **Admin** → `https://main.d1abc2def3ghi.amplifyapp.com/admin`

### Demo Credentials:
| Role | Email | Password |
|------|-------|----------|
| Super Admin | `admin@uhp.com` | `Admin@123` |
| Salon Owner | `owner1@test.com` | `Owner@123` |
| Customer | `alice@test.com` | `Password@123` |

---

## 🔐 Step 5 — Production Security Hardening

### Update JWT Secret
The secret set in SAM deploy should be a random 64-character string:
```bash
# Generate a strong secret:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Update CORS
Set `CorsOrigin` to your exact Amplify domain — never leave it as `*` in production.

### Enable Amplify Basic Auth (optional)
For staging environments, add basic auth in Amplify Console → **"Access control"**.

---

## 🔄 CI/CD — Automatic Deployments

### Frontend (Amplify)
Every push to `main` triggers an automatic Amplify build and deploy. No extra config needed.

### Backend (Lambda)
Add this to a GitHub Actions workflow (`.github/workflows/deploy.yml`):
```yaml
name: Deploy Backend
on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - 'lambda.js'
      - 'template.yaml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id:     ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region:            ap-south-1
      - uses: aws-actions/setup-sam@v2
      - run: sam build
      - run: sam deploy --no-confirm-changeset --no-fail-on-empty-changeset
        env:
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
```

Add these GitHub repo secrets:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `JWT_SECRET`

---

## 📊 Architecture Diagram

```
                    ┌─────────────────────────────────┐
  User Browser      │         AWS Cloud                │
        │           │                                  │
        │  HTTPS    │  ┌──────────────────────────┐   │
        ├──────────►│  │  AWS Amplify Hosting      │   │
        │           │  │  (CloudFront + S3)         │   │
        │           │  │                            │   │
        │           │  │  /customer → index.html    │   │
        │           │  │  /owner    → index.html    │   │
        │           │  │  /admin    → index.html    │   │
        │           │  └──────────────┬─────────────┘  │
        │           │                 │ Rewrite          │
        │           │                 │ /api/* →         │
        │           │  ┌──────────────▼─────────────┐  │
        │           │  │  API Gateway (HTTP API v2)  │  │
        │           │  └──────────────┬──────────────┘  │
        │           │                 │ Invoke           │
        │           │  ┌──────────────▼──────────────┐  │
        │           │  │  AWS Lambda                  │  │
        │           │  │  • Express.js (serverless)   │  │
        │           │  │  • SQLite in /tmp (ephemeral) │ │
        │           │  │  • Auto-seeds on cold start   │ │
        │           │  └──────────────────────────────┘  │
        │           └─────────────────────────────────────┘
```

---

## ⚠️ Important Notes

### SQLite Persistence in Lambda
- Lambda's `/tmp` is **ephemeral** — data resets on cold starts and doesn't persist between Lambda instances.
- The app **auto-seeds** on every cold start, so demo data is always available.
- For **production with real user data**, migrate to **Amazon RDS (PostgreSQL)** or **DynamoDB**.

### Lambda Cold Starts
- First request after idle: ~2-3 seconds (seeding SQLite)
- Warm requests: ~50-200ms
- Use AWS Lambda **Provisioned Concurrency** to eliminate cold starts in production.

### Scaling
- Lambda automatically scales to handle concurrent requests.
- SQLite in `/tmp` means each Lambda instance has its own database copy.
- For multi-instance consistency, replace SQLite with RDS Aurora Serverless.

---

## 💰 Estimated AWS Costs (Free Tier)

| Service | Free Tier | After Free Tier |
|---------|-----------|-----------------|
| Lambda | 1M requests/month | ~$0.20 per 1M requests |
| API Gateway | 1M requests/month | ~$1.00 per 1M requests |
| Amplify Hosting | 1000 build minutes | $0.01 per build minute |
| CloudFront | 1TB data transfer | $0.085 per GB |

**Total for a typical small app: $0–5/month**

---

## 🆘 Troubleshooting

### "No Access-Control-Allow-Origin" error
→ CORS is not configured. Re-run `sam deploy` with the correct `CorsOrigin` parameter.

### API returns 502 or 504
→ Lambda timeout. Check CloudWatch Logs → `/aws/lambda/urban-hairplaza-api`.

### Frontend shows blank page
→ Check the Amplify build logs. Ensure `amplify.yml` `baseDirectory: frontend` is correct.

### Login returns 401
→ JWT_SECRET mismatch. Re-deploy Lambda with correct `--parameter-overrides JwtSecret=...`.

### Check Lambda logs:
```bash
aws logs tail /aws/lambda/urban-hairplaza-api --follow
```
