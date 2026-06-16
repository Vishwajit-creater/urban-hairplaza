# 🏪 Urban HairPlaza

> A full-stack multi-vendor salon booking platform — connecting customers with beauty & salon service providers across India.

![Node.js](https://img.shields.io/badge/Node.js-22%2B-green?logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-black?logo=express)
![SQLite](https://img.shields.io/badge/SQLite-built--in-blue?logo=sqlite)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ Features

### 🛍️ Customer Portal (`/customer`)
- Browse & search salons by name, city, or category
- View full salon profiles — gallery, services, staff, ratings & reviews
- Multi-step booking wizard — select services → pick date/time → choose staff → apply coupon → confirm
- Simulated UPI/card payment flow
- My Bookings page — view upcoming/past bookings, submit star reviews, cancel bookings

### 🏪 Salon Owner Dashboard (`/owner`)
- KPI dashboard with today's bookings, monthly revenue, avg rating
- Booking management — list & calendar view, mark complete / no-show
- Service CRUD — add/edit/remove services by category; price changes don't affect historical bookings
- Staff management — add staff, assign services, manage leave dates
- Salon settings — update info, operating hours, photo gallery
- Analytics — 30-day revenue chart, booking status breakdown, top services, staff utilization

### ⚙️ Super Admin Console (`/admin`)
- Review & approve/reject new salon registrations
- Platform-wide analytics — salons, bookings, revenue, commission earned
- Revenue & commission per salon with adjustable per-salon commission rates
- Subscription plan management (Basic / Pro / Enterprise pricing)
- Paginated audit log with action & entity filters

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v22+ |
| API Server | Express.js 4 |
| Database | SQLite via `node:sqlite` (built-in, zero native deps) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Security | Helmet, express-rate-limit, CORS origin whitelist |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Fonts | Google Fonts (Outfit) |
| Images | Unsplash (demo) |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js v22.5.0 or higher** (uses built-in `node:sqlite`)
- npm

### 1. Clone
```bash
git clone https://github.com/YOUR_USERNAME/urban-hairplaza.git
cd urban-hairplaza
```

### 2. Install dependencies
```bash
npm install
```
> ✅ No native build tools (Visual Studio, Python) required — uses Node's built-in SQLite.

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env with your values (especially JWT_SECRET in production)
```

### 4. Seed the database
```bash
npm run seed
```

### 5. Start the server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Visit **http://localhost:3000** — it redirects to the Customer portal.

---

## 🔑 Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | `admin@uhp.com` | `Admin@123` |
| Salon Owner 1 | `owner1@test.com` | `Owner@123` |
| Salon Owner 2 | `owner2@test.com` | `Owner@123` |
| Customer | `alice@test.com` | `Password@123` |

**Demo Coupons:** `DEMO10` (10% off) · `DEMO20` (20% off) · `FLAT500` (₹500 off) · `FREEFIRST` (100% off, 1 use)

---

## 📁 Project Structure

```
urban-hairplaza/
├── backend/
│   ├── db/
│   │   ├── database.js        # SQLite connection & pragmas
│   │   ├── schema.sql         # All table definitions + indexes
│   │   └── seed.js            # Demo data seeder
│   ├── middleware/
│   │   ├── auth.js            # JWT authentication & RBAC
│   │   └── errorHandler.js    # Global error handler
│   ├── routes/
│   │   ├── auth.js            # POST /register, /login, GET /me
│   │   ├── salons.js          # Salon search, profile, slot availability
│   │   ├── bookings.js        # Booking CRUD, reviews
│   │   ├── owner.js           # Owner-scoped management APIs
│   │   └── admin.js           # Platform admin APIs
│   └── server.js              # Express app entry point
├── frontend/
│   ├── customer/
│   │   ├── index.html         # Landing + salon search
│   │   ├── salon.html         # Salon profile page
│   │   ├── book.html          # Booking wizard
│   │   └── bookings.html      # My Bookings + reviews
│   ├── owner/
│   │   ├── index.html         # Dashboard home
│   │   ├── bookings.html      # Booking management
│   │   ├── services.html      # Service CRUD
│   │   ├── staff.html         # Staff + leave management
│   │   ├── analytics.html     # Revenue analytics
│   │   └── settings.html      # Salon settings
│   └── admin/
│       ├── index.html         # Admin dashboard
│       ├── salons.html        # Salon approval & commission
│       ├── analytics.html     # Platform analytics
│       ├── subscriptions.html # Plan management
│       └── audit.html         # Audit log viewer
├── .env.example               # Environment variable template
├── .gitignore
└── package.json
```

---

## 🔌 API Reference

All API endpoints are under `/api/`.

### Authentication
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/register` | Register customer or owner | — |
| POST | `/api/auth/login` | Login, receive JWT | — |
| GET  | `/api/auth/me` | Current user profile | ✅ |

### Salons
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/salons` | List approved salons (search, category, geo filter) | — |
| GET | `/api/salons/:id` | Full salon profile | — |
| GET | `/api/salons/:id/slots` | Available booking slots | — |
| POST | `/api/salons` | Create salon (pending) | Owner |
| PATCH | `/api/salons/:id` | Update salon | Owner |

### Bookings
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/bookings` | Create booking | Customer |
| GET  | `/api/bookings` | List own bookings | Customer |
| GET  | `/api/bookings/:id` | Booking details | ✅ |
| PATCH | `/api/bookings/:id/status` | Update status | Owner/Admin |
| POST | `/api/bookings/:id/review` | Submit review | Customer |

### Owner (role=owner)
`GET /api/owner/salon` · `GET /api/owner/bookings` · `GET /api/owner/analytics`  
`GET/POST/PUT/DELETE /api/owner/services`  
`GET/POST/PUT/DELETE /api/owner/staff` · `POST/DELETE /api/owner/staff/:id/leaves`  
`PATCH /api/owner/salon/hours` · `PATCH /api/owner/salon/photos`

### Admin (role=admin)
`GET /api/admin/salons` · `PATCH /api/admin/salons/:id/status`  
`PUT /api/admin/salons/:id/commission` · `GET /api/admin/analytics`  
`GET /api/admin/audit-logs` · `GET/PUT /api/admin/plans` · `GET /api/admin/users`

---

## 🛡️ Security Features

- **Helmet** — sets 15 HTTP security headers (X-Frame-Options, HSTS, CSP, etc.)
- **Rate limiting** — 200 req/15 min globally; 20 req/15 min on auth endpoints
- **JWT authentication** — 7-day expiry; secret via environment variable
- **RBAC** — role-based access control on all protected routes
- **bcrypt** — password hashing with cost factor 10
- **Input validation** — required fields checked on all write operations
- **Price snapshotting** — booking prices frozen at time of checkout
- **Double-booking prevention** — overlap check before confirming any booking
- **CORS** — origin whitelist in production via `CORS_ORIGIN` env var
- **No stack traces** in production error responses

---

## 🌐 Deployment (Render / Railway / Fly.io)

1. Set environment variables:
   - `NODE_ENV=production`
   - `JWT_SECRET=<64-char random string>`
   - `PORT=10000` (or platform default)
   - `DB_PATH=backend/db/urban_hairplaza.db`

2. Set start command: `npm start`
3. Run seed (one-time): `npm run seed`

> **Note:** SQLite is ideal for demo/MVP. For production at scale, migrate to PostgreSQL using the same schema — the route logic stays identical.

---

## 📄 License

MIT © 2025 Urban HairPlaza
