-- ============================================================
-- Urban HairPlaza — PostgreSQL Schema (Supabase)
-- Run this once in your Supabase project's SQL Editor.
-- All tables use IF NOT EXISTS so it is safe to re-run.
-- ============================================================

-- ── Users ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'customer'
                    CHECK (role IN ('customer', 'owner', 'admin')),
  phone           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Salons ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salons (
  id               BIGSERIAL PRIMARY KEY,
  owner_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  slug             TEXT UNIQUE NOT NULL,
  description      TEXT,
  address          TEXT,
  city             TEXT,
  lat              NUMERIC(10, 7) DEFAULT 0,
  lng              NUMERIC(10, 7) DEFAULT 0,
  category         TEXT DEFAULT 'Hair',
  phone            TEXT,
  email            TEXT,
  website          TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),
  commission_rate  NUMERIC(5, 2) DEFAULT 10.0,
  subscription_plan TEXT DEFAULT 'basic',
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Salon Photos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salon_photos (
  id            BIGSERIAL PRIMARY KEY,
  salon_id      BIGINT REFERENCES salons(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  caption       TEXT,
  is_primary    SMALLINT DEFAULT 0,
  display_order INTEGER DEFAULT 0
);

-- ── Salon Operating Hours ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salon_hours (
  id           BIGSERIAL PRIMARY KEY,
  salon_id     BIGINT REFERENCES salons(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time    TEXT,
  close_time   TEXT,
  is_closed    SMALLINT DEFAULT 0,
  UNIQUE (salon_id, day_of_week)
);

-- ── Services ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id           BIGSERIAL PRIMARY KEY,
  salon_id     BIGINT REFERENCES salons(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  category     TEXT DEFAULT 'Hair',
  price        NUMERIC(10, 2) NOT NULL,
  duration_min INTEGER NOT NULL,
  is_active    SMALLINT DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Staff Members ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id          BIGSERIAL PRIMARY KEY,
  salon_id    BIGINT REFERENCES salons(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  bio         TEXT,
  avatar_url  TEXT,
  is_active   SMALLINT DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Staff ↔ Service Assignments ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_services (
  staff_id    BIGINT REFERENCES staff(id) ON DELETE CASCADE,
  service_id  BIGINT REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

-- ── Staff Leave Dates ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_leaves (
  id          BIGSERIAL PRIMARY KEY,
  staff_id    BIGINT REFERENCES staff(id) ON DELETE CASCADE,
  leave_date  TEXT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Bookings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                    BIGSERIAL PRIMARY KEY,
  customer_id           BIGINT REFERENCES users(id),
  salon_id              BIGINT REFERENCES salons(id),
  staff_id              BIGINT REFERENCES staff(id),
  booking_date          TEXT NOT NULL,
  start_time            TEXT NOT NULL,
  end_time              TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'confirmed'
                          CHECK (status IN ('pending','confirmed','completed','no_show','cancelled')),
  notes                 TEXT,
  total_price_snapshot  NUMERIC(10, 2) DEFAULT 0,
  coupon_code           TEXT,
  discount_amount       NUMERIC(10, 2) DEFAULT 0,
  payment_status        TEXT DEFAULT 'paid',
  payment_ref           TEXT,
  payment_method        TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── Booking ↔ Services (price snapshot) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_services (
  id                    BIGSERIAL PRIMARY KEY,
  booking_id            BIGINT REFERENCES bookings(id) ON DELETE CASCADE,
  service_id            BIGINT REFERENCES services(id),
  service_name_snapshot TEXT,
  price_snapshot        NUMERIC(10, 2),
  duration_snapshot     INTEGER
);

-- ── Reviews ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id           BIGSERIAL PRIMARY KEY,
  booking_id   BIGINT UNIQUE REFERENCES bookings(id),
  customer_id  BIGINT REFERENCES users(id),
  salon_id     BIGINT REFERENCES salons(id),
  rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Audit Logs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      BIGINT REFERENCES users(id),
  actor_name    TEXT,
  action        TEXT,
  entity_type   TEXT,
  entity_id     BIGINT,
  metadata_json JSONB,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Subscription Plans ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_plans (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,
  price         NUMERIC(10, 2),
  max_staff     INTEGER,
  max_services  INTEGER,
  features_json JSONB,
  is_active     SMALLINT DEFAULT 1
);

-- ── Coupons ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id                  BIGSERIAL PRIMARY KEY,
  code                TEXT UNIQUE NOT NULL,
  discount_type       TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value      NUMERIC(10, 2),
  min_booking_amount  NUMERIC(10, 2) DEFAULT 0,
  max_uses            INTEGER,
  uses_count          INTEGER DEFAULT 0,
  expires_at          TIMESTAMPTZ,
  is_active           SMALLINT DEFAULT 1
);

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_salons_status        ON salons(status);
CREATE INDEX IF NOT EXISTS idx_salons_category      ON salons(category);
CREATE INDEX IF NOT EXISTS idx_salons_city          ON salons(city);
CREATE INDEX IF NOT EXISTS idx_bookings_salon_date  ON bookings(salon_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_staff_date  ON bookings(staff_id, booking_date, start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_customer    ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_salon        ON reviews(salon_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor     ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity    ON audit_logs(entity_type, entity_id);
