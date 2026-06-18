# Urban HairPlaza — Deployment Summary

## 🌐 Live URLs

| Service | URL |
|---------|-----|
| **Frontend (Amplify)** | https://main.d3cr5x19t0a872.amplifyapp.com |
| **Customer Portal** | https://main.d3cr5x19t0a872.amplifyapp.com/customer/ |
| **Owner Portal** | https://main.d3cr5x19t0a872.amplifyapp.com/owner/ |
| **Admin Console** | https://main.d3cr5x19t0a872.amplifyapp.com/admin/ |
| **Backend API (Render)** | https://urban-hairplaza.onrender.com |
| **Database (Supabase)** | Project: girxzdejdxhrritjvbts |

---

## 🔑 Test Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@uhp.com | Admin@123 |
| Salon Owner | owner1@test.com | Owner@123 |
| Customer | alice@test.com | Password@123 |

**Coupon codes:** `DEMO10` (10% off) · `DEMO20` (20% off) · `FREEFIRST` (100% off) · `FLAT500` (₹500 off)

---

## 🏗️ Architecture

```
Browser
  │
  ▼
AWS Amplify (CloudFront + S3)
  ├── /customer/*  → frontend/customer/
  ├── /owner/*     → frontend/owner/
  ├── /admin/*     → frontend/admin/
  └── /api/<*>  ─────────────────────► Render (Express + Node.js)
                                              │
                                              ▼
                                       Supabase (PostgreSQL)
```

---

## ⚙️ Amplify Rewrite Rule Required

In AWS Amplify Console → Rewrites and redirects:

| Source | Target | Type |
|--------|--------|------|
| `/api/<*>` | `https://urban-hairplaza.onrender.com/api/<*>` | `200 (Rewrite)` |

---

## 🗄️ Database Setup

Run `backend/db/supabase_setup.sql` in the Supabase SQL Editor (one-time setup).

---

## 🔧 Environment Variables

### Render (backend)
| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql://postgres:[password]@db.girxzdejdxhrritjvbts.supabase.co:5432/postgres` |
| `JWT_SECRET` | (secret key) |
| `NODE_ENV` | `production` |
| `PORT` | `10000` |
| `CORS_ORIGIN` | `https://main.d3cr5x19t0a872.amplifyapp.com` |

### Amplify (frontend)
| Key | Value |
|-----|-------|
| `API_GATEWAY_URL` | `https://urban-hairplaza.onrender.com` |

---

## 📋 Maintenance

- **Redeploy backend**: Push to `main` branch → Render auto-deploys
- **Redeploy frontend**: Push to `main` branch → Amplify auto-deploys
- **Re-seed database**: Run `supabase_setup.sql` in Supabase SQL Editor
- **View logs**: Render Dashboard → Logs tab
