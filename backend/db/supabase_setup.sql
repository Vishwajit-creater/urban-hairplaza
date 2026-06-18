-- ============================================================
-- Urban HairPlaza — COMPLETE SETUP SQL
-- 
-- HOW TO RUN:
-- 1. Go to https://supabase.com → your project
-- 2. Click "SQL Editor" in the left sidebar
-- 3. Click "New query"
-- 4. Paste this ENTIRE file → click "Run"
-- ============================================================

-- ── SCHEMA ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer'
                  CHECK (role IN ('customer', 'owner', 'admin')),
  phone         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS salon_photos (
  id            BIGSERIAL PRIMARY KEY,
  salon_id      BIGINT REFERENCES salons(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  caption       TEXT,
  is_primary    SMALLINT DEFAULT 0,
  display_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS salon_hours (
  id           BIGSERIAL PRIMARY KEY,
  salon_id     BIGINT REFERENCES salons(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time    TEXT,
  close_time   TEXT,
  is_closed    SMALLINT DEFAULT 0,
  UNIQUE (salon_id, day_of_week)
);

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

CREATE TABLE IF NOT EXISTS staff_services (
  staff_id    BIGINT REFERENCES staff(id) ON DELETE CASCADE,
  service_id  BIGINT REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

CREATE TABLE IF NOT EXISTS staff_leaves (
  id          BIGSERIAL PRIMARY KEY,
  staff_id    BIGINT REFERENCES staff(id) ON DELETE CASCADE,
  leave_date  TEXT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS booking_services (
  id                    BIGSERIAL PRIMARY KEY,
  booking_id            BIGINT REFERENCES bookings(id) ON DELETE CASCADE,
  service_id            BIGINT REFERENCES services(id),
  service_name_snapshot TEXT,
  price_snapshot        NUMERIC(10, 2),
  duration_snapshot     INTEGER
);

CREATE TABLE IF NOT EXISTS reviews (
  id           BIGSERIAL PRIMARY KEY,
  booking_id   BIGINT UNIQUE REFERENCES bookings(id),
  customer_id  BIGINT REFERENCES users(id),
  salon_id     BIGINT REFERENCES salons(id),
  rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS subscription_plans (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,
  price         NUMERIC(10, 2),
  max_staff     INTEGER,
  max_services  INTEGER,
  features_json JSONB,
  is_active     SMALLINT DEFAULT 1
);

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

-- ── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_salons_status        ON salons(status);
CREATE INDEX IF NOT EXISTS idx_salons_category      ON salons(category);
CREATE INDEX IF NOT EXISTS idx_salons_city          ON salons(city);
CREATE INDEX IF NOT EXISTS idx_bookings_salon_date  ON bookings(salon_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_staff_date  ON bookings(staff_id, booking_date, start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_customer    ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_salon        ON reviews(salon_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor     ON audit_logs(actor_id);

-- ── SEED DATA ─────────────────────────────────────────────────────────────
-- Subscription Plans
INSERT INTO subscription_plans (name, price, max_staff, max_services, features_json, is_active)
VALUES
  ('basic',       999,  5,  20, '["5 staff","20 services","Basic analytics","Email support"]',       1),
  ('pro',        2499, 15,  60, '["15 staff","60 services","Advanced analytics","Priority support"]', 1),
  ('enterprise', 4999, -1, -1,  '["Unlimited staff","Unlimited services","Full analytics","24/7 support","API access"]', 1)
ON CONFLICT (name) DO NOTHING;

-- Coupons
INSERT INTO coupons (code, discount_type, discount_value, min_booking_amount, max_uses, is_active)
VALUES
  ('DEMO10',    'percent', 10,    0,    1000, 1),
  ('DEMO20',    'percent', 20,    1000, 500,  1),
  ('FREEFIRST', 'percent', 100,   0,    1,    1),
  ('FLAT500',   'fixed',   500,   2000, 200,  1)
ON CONFLICT (code) DO NOTHING;

-- Users (passwords hashed with bcryptjs rounds=10)
-- admin@uhp.com    → Admin@123
-- owner*@test.com  → Owner@123
-- *@test.com       → Password@123
INSERT INTO users (name, email, password_hash, role) VALUES
  ('Super Admin',      'admin@uhp.com',    '$2a$10$8cOpK6yYwOWGrHn6nB7mx..6QdFgw2d4zOxDsBlJe/OaPvuQv.1jS', 'admin'),
  ('Priya Sharma',     'owner1@test.com',  '$2a$10$TBky0U3Q5dsVIMSaZhA2NuRF5EFXij8xwJmas7rNCsK/ZJZk66VzW', 'owner'),
  ('Rahul Verma',      'owner2@test.com',  '$2a$10$TBky0U3Q5dsVIMSaZhA2NuRF5EFXij8xwJmas7rNCsK/ZJZk66VzW', 'owner'),
  ('Meera Nair',       'owner3@test.com',  '$2a$10$TBky0U3Q5dsVIMSaZhA2NuRF5EFXij8xwJmas7rNCsK/ZJZk66VzW', 'owner'),
  ('Arjun Singh',      'owner4@test.com',  '$2a$10$TBky0U3Q5dsVIMSaZhA2NuRF5EFXij8xwJmas7rNCsK/ZJZk66VzW', 'owner'),
  ('Alice Fernandes',  'alice@test.com',   '$2a$10$6LpfdTDnm3.A368CyZWMAe8CCSkeyh0B/I0iOltII6ZoiJUI8Nw7O', 'customer'),
  ('Bob Mathur',       'bob@test.com',     '$2a$10$6LpfdTDnm3.A368CyZWMAe8CCSkeyh0B/I0iOltII6ZoiJUI8Nw7O', 'customer'),
  ('Carol DSouza',     'carol@test.com',   '$2a$10$6LpfdTDnm3.A368CyZWMAe8CCSkeyh0B/I0iOltII6ZoiJUI8Nw7O', 'customer'),
  ('Dave Kumar',       'dave@test.com',    '$2a$10$6LpfdTDnm3.A368CyZWMAe8CCSkeyh0B/I0iOltII6ZoiJUI8Nw7O', 'customer'),
  ('Eve Chatterjee',   'eve@test.com',     '$2a$10$6LpfdTDnm3.A368CyZWMAe8CCSkeyh0B/I0iOltII6ZoiJUI8Nw7O', 'customer')
ON CONFLICT (email) DO NOTHING;

-- Salons
INSERT INTO salons (owner_id, name, slug, description, address, city, lat, lng, category, phone, email, status)
SELECT id, 'Glamour Studio', 'glamour-studio',
  'Premium Hair & Beauty salon with expert stylists.',
  '12 Hill Rd, Bandra West', 'Mumbai', 19.0596, 72.8295, 'Hair & Beauty',
  '+91-9820012345', 'glamour-studio@example.com', 'approved'
FROM users WHERE email='owner1@test.com'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO salons (owner_id, name, slug, description, address, city, lat, lng, category, phone, email, status)
SELECT id, 'The Blade Barbers', 'the-blade-barbers',
  'Premium Barbershop in the heart of Koramangala.',
  '45 Koramangala 5th Block', 'Bangalore', 12.9279, 77.6271, 'Barbershop',
  '+91-9900012345', 'blade-barbers@example.com', 'approved'
FROM users WHERE email='owner2@test.com'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO salons (owner_id, name, slug, description, address, city, lat, lng, category, phone, email, status)
SELECT id, 'Serenity Spa & Salon', 'serenity-spa-salon',
  'Luxury Spa & Wellness retreat in Hauz Khas.',
  '7 Hauz Khas Village', 'Delhi', 28.5494, 77.2001, 'Spa & Wellness',
  '+91-9110012345', 'serenity-spa@example.com', 'approved'
FROM users WHERE email='owner3@test.com'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO salons (owner_id, name, slug, description, address, city, lat, lng, category, phone, email, status)
SELECT id, 'NailArt Paradise', 'nailart-paradise',
  'Specialist Nail Studio in Andheri.',
  '33 Andheri West Main Road', 'Mumbai', 19.1136, 72.8697, 'Nail Studio',
  '+91-9820098765', 'nailart@example.com', 'pending'
FROM users WHERE email='owner4@test.com'
ON CONFLICT (slug) DO NOTHING;

-- Salon Hours (Mon=1 through Sun=0; Sun closed)
INSERT INTO salon_hours (salon_id, day_of_week, open_time, close_time, is_closed)
SELECT s.id, d.dow,
  CASE WHEN d.dow = 0 THEN '10:00' WHEN d.dow = 6 THEN '10:00' ELSE '09:00' END,
  CASE WHEN d.dow = 0 THEN '17:00' WHEN d.dow = 6 THEN '19:00' ELSE '20:00' END,
  CASE WHEN d.dow = 0 THEN 1 ELSE 0 END
FROM salons s, (VALUES (0),(1),(2),(3),(4),(5),(6)) AS d(dow)
ON CONFLICT (salon_id, day_of_week) DO NOTHING;

-- Salon Photos
INSERT INTO salon_photos (salon_id, url, caption, is_primary, display_order)
SELECT s.id, p.url, p.cap, p.pri, p.ord
FROM salons s,
LATERAL (VALUES
  ('https://images.unsplash.com/photo-1560066263-57e9a3d3c0ba?w=800', 'Salon interior', 1, 0),
  ('https://images.unsplash.com/photo-1522337360846-a0b7e54b440a?w=800', 'Styling area',  0, 1),
  ('https://images.unsplash.com/photo-1562322140-8baeececf3df?w=800', 'Reception',      0, 2),
  ('https://images.unsplash.com/photo-1521590832167-7bcbef1d37af?w=800', 'Treatment room',0, 3)
) AS p(url, cap, pri, ord)
WHERE s.status IN ('approved','pending');

-- Services — Glamour Studio
INSERT INTO services (salon_id, name, category, price, duration_min)
SELECT id, svc.name, svc.cat, svc.price, svc.dur
FROM salons, (VALUES
  ('Haircut & Style',    'Hair',   800,  60),
  ('Hair Colour (Full)', 'Hair',   2500, 120),
  ('Balayage',           'Hair',   4500, 180),
  ('Keratin Treatment',  'Hair',   5000, 180),
  ('Bridal Makeup',      'Makeup', 8000, 120),
  ('Party Makeup',       'Makeup', 3500, 90)
) AS svc(name, cat, price, dur)
WHERE slug = 'glamour-studio';

-- Services — The Blade Barbers
INSERT INTO services (salon_id, name, category, price, duration_min)
SELECT id, svc.name, svc.cat, svc.price, svc.dur
FROM salons, (VALUES
  ('Classic Haircut',    'Haircut', 350, 30),
  ('Beard Trim & Shape', 'Beard',   250, 20),
  ('Hot Towel Shave',    'Shave',   450, 45),
  ('Hair + Beard Combo', 'Haircut', 550, 50),
  ('Kids Haircut',       'Haircut', 250, 20)
) AS svc(name, cat, price, dur)
WHERE slug = 'the-blade-barbers';

-- Services — Serenity Spa
INSERT INTO services (salon_id, name, category, price, duration_min)
SELECT id, svc.name, svc.cat, svc.price, svc.dur
FROM salons, (VALUES
  ('Swedish Massage (60 min)', 'Massage', 2500, 60),
  ('Deep Tissue Massage',      'Massage', 3200, 75),
  ('Ayurvedic Facial',         'Facial',  1800, 60),
  ('Anti-Ageing Facial',       'Facial',  2800, 75),
  ('Full Body Scrub',          'Body',    4000, 90),
  ('Aromatherapy Session',     'Wellness',3500, 90)
) AS svc(name, cat, price, dur)
WHERE slug = 'serenity-spa-salon';

-- Services — NailArt Paradise
INSERT INTO services (salon_id, name, category, price, duration_min)
SELECT id, svc.name, svc.cat, svc.price, svc.dur
FROM salons, (VALUES
  ('Basic Manicure',     'Manicure', 500,  40),
  ('Gel Manicure',       'Manicure', 1200, 60),
  ('Basic Pedicure',     'Pedicure', 600,  45),
  ('Nail Art (per hand)','Art',      800,  60)
) AS svc(name, cat, price, dur)
WHERE slug = 'nailart-paradise';

-- Staff — one per salon (insert remaining via app)
INSERT INTO staff (salon_id, name, bio, phone)
SELECT s.id, st.name, st.name || ' is an expert stylist with 5+ years of experience.', '+91-9000000001'
FROM salons s, (VALUES
  ('glamour-studio',     'Kavya Reddy'),
  ('glamour-studio',     'Ritu Agarwal'),
  ('glamour-studio',     'Sonali Mehta'),
  ('the-blade-barbers',  'Vikram Bose'),
  ('the-blade-barbers',  'Nikhil Joshi'),
  ('the-blade-barbers',  'Ajay Rawat'),
  ('serenity-spa-salon', 'Lakshmi Iyer'),
  ('serenity-spa-salon', 'Priyanka Das'),
  ('nailart-paradise',   'Deepa Nair')
) AS st(slug, name)
WHERE s.slug = st.slug;

-- Staff → Service assignments (each staff can do all salon services)
INSERT INTO staff_services (staff_id, service_id)
SELECT st.id, sv.id
FROM staff st
JOIN salons s ON st.salon_id = s.id
JOIN services sv ON sv.salon_id = s.id
ON CONFLICT DO NOTHING;

-- Audit log — admin approvals
INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json)
SELECT u.id, u.name, 'salon_approved', 'salon', s.id, jsonb_build_object('salon_name', s.name)
FROM users u, salons s
WHERE u.email = 'admin@uhp.com' AND s.status = 'approved';

-- Sample bookings (last 7 days, confirmed/completed)
INSERT INTO bookings
  (customer_id, salon_id, staff_id, booking_date, start_time, end_time,
   status, total_price_snapshot, payment_status, payment_ref, payment_method)
SELECT
  (SELECT id FROM users WHERE email='alice@test.com'),
  s.id,
  (SELECT id FROM staff WHERE salon_id = s.id LIMIT 1),
  (CURRENT_DATE - INTERVAL '3 days')::text,
  '10:00', '11:00', 'completed', 800, 'paid', 'UHP' || floor(random()*999999)::text, 'upi'
FROM salons s WHERE s.slug = 'glamour-studio';

INSERT INTO bookings
  (customer_id, salon_id, staff_id, booking_date, start_time, end_time,
   status, total_price_snapshot, payment_status, payment_ref, payment_method)
SELECT
  (SELECT id FROM users WHERE email='bob@test.com'),
  s.id,
  (SELECT id FROM staff WHERE salon_id = s.id LIMIT 1),
  (CURRENT_DATE - INTERVAL '1 day')::text,
  '14:00', '14:30', 'completed', 350, 'paid', 'UHP' || floor(random()*999999)::text, 'upi'
FROM salons s WHERE s.slug = 'the-blade-barbers';

INSERT INTO bookings
  (customer_id, salon_id, staff_id, booking_date, start_time, end_time,
   status, total_price_snapshot, payment_status, payment_ref, payment_method)
SELECT
  (SELECT id FROM users WHERE email='carol@test.com'),
  s.id,
  (SELECT id FROM staff WHERE salon_id = s.id LIMIT 1),
  CURRENT_DATE::text,
  '11:00', '12:00', 'confirmed', 2500, 'paid', 'UHP' || floor(random()*999999)::text, 'upi'
FROM salons s WHERE s.slug = 'serenity-spa-salon';

INSERT INTO bookings
  (customer_id, salon_id, staff_id, booking_date, start_time, end_time,
   status, total_price_snapshot, payment_status, payment_ref, payment_method)
SELECT
  (SELECT id FROM users WHERE email='dave@test.com'),
  s.id,
  (SELECT id FROM staff WHERE salon_id = s.id LIMIT 1),
  (CURRENT_DATE + INTERVAL '2 days')::text,
  '15:00', '16:00', 'confirmed', 800, 'paid', 'UHP' || floor(random()*999999)::text, 'upi'
FROM salons s WHERE s.slug = 'glamour-studio';

-- Booking services snapshots
INSERT INTO booking_services (booking_id, service_id, service_name_snapshot, price_snapshot, duration_snapshot)
SELECT b.id, sv.id, sv.name, sv.price, sv.duration_min
FROM bookings b
JOIN services sv ON sv.salon_id = b.salon_id
WHERE NOT EXISTS (SELECT 1 FROM booking_services WHERE booking_id = b.id)
AND sv.id = (SELECT id FROM services WHERE salon_id = b.salon_id ORDER BY id LIMIT 1);

-- Reviews for completed bookings
INSERT INTO reviews (booking_id, customer_id, salon_id, rating, comment)
SELECT b.id, b.customer_id, b.salon_id, 5, 'Excellent service, highly recommend!'
FROM bookings b
WHERE b.status = 'completed'
ON CONFLICT (booking_id) DO NOTHING;

-- Final check
SELECT
  (SELECT count(*) FROM users)             AS users,
  (SELECT count(*) FROM salons)            AS salons,
  (SELECT count(*) FROM services)          AS services,
  (SELECT count(*) FROM staff)             AS staff,
  (SELECT count(*) FROM bookings)          AS bookings,
  (SELECT count(*) FROM subscription_plans) AS plans,
  (SELECT count(*) FROM coupons)           AS coupons;
