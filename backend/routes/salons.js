'use strict';
const express = require('express');
const pool    = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function timeToMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// GET /api/salons — list approved salons
router.get('/', async (req, res, next) => {
  try {
    const { search, category, lat, lng, radius_km = 50, sort } = req.query;

    const { rows: salons } = await pool.query(`
      SELECT s.*,
        u.name AS owner_name,
        COALESCE(AVG(r.rating), 0) AS avg_rating,
        COUNT(DISTINCT r.id) AS review_count,
        COALESCE(MIN(sv.price), 0) AS min_price,
        (SELECT url FROM salon_photos WHERE salon_id = s.id AND is_primary = 1 LIMIT 1) AS primary_photo
      FROM salons s
      LEFT JOIN users u ON s.owner_id = u.id
      LEFT JOIN reviews r ON r.salon_id = s.id
      LEFT JOIN services sv ON sv.salon_id = s.id AND sv.is_active = 1
      WHERE s.status = 'approved'
      GROUP BY s.id, u.name
      ORDER BY s.name
    `);

    let result = salons;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) || (s.city || '').toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q)
      );
    }
    if (category && category !== 'All') {
      result = result.filter(s => s.category === category);
    }
    if (lat && lng) {
      const userLat = parseFloat(lat), userLng = parseFloat(lng);
      result = result.map(s => ({
        ...s,
        distance_km: haversine(userLat, userLng, parseFloat(s.lat), parseFloat(s.lng))
      })).filter(s => s.distance_km <= parseFloat(radius_km));
    }
    if (sort === 'rating') result.sort((a, b) => b.avg_rating - a.avg_rating);
    else if (sort === 'nearest' && lat) result.sort((a, b) => (a.distance_km || 0) - (b.distance_km || 0));

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/salons/:id — full salon profile
router.get('/:id', async (req, res, next) => {
  try {
    const { rows: [salon] } = await pool.query(`
      SELECT s.*, u.name AS owner_name, u.email AS owner_email,
        COALESCE(AVG(r.rating), 0) AS avg_rating,
        COUNT(DISTINCT r.id) AS review_count
      FROM salons s
      LEFT JOIN users u ON s.owner_id = u.id
      LEFT JOIN reviews r ON r.salon_id = s.id
      WHERE s.id = $1
      GROUP BY s.id, u.name, u.email
    `, [req.params.id]);
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    const [{ rows: hours }, { rows: services }, { rows: staff }, { rows: photos }, { rows: reviews }] =
      await Promise.all([
        pool.query('SELECT * FROM salon_hours WHERE salon_id = $1 ORDER BY day_of_week', [salon.id]),
        pool.query('SELECT * FROM services WHERE salon_id = $1 AND is_active = 1 ORDER BY category, name', [salon.id]),
        pool.query('SELECT * FROM staff WHERE salon_id = $1 AND is_active = 1', [salon.id]),
        pool.query('SELECT * FROM salon_photos WHERE salon_id = $1 ORDER BY is_primary DESC, display_order', [salon.id]),
        pool.query(`
          SELECT r.*, u.name AS customer_name
          FROM reviews r JOIN users u ON r.customer_id = u.id
          WHERE r.salon_id = $1 ORDER BY r.created_at DESC LIMIT 10
        `, [salon.id]),
      ]);

    const staffWithServices = await Promise.all(staff.map(async s => {
      const { rows: srvs } = await pool.query(`
        SELECT sv.id, sv.name FROM staff_services ss
        JOIN services sv ON ss.service_id = sv.id
        WHERE ss.staff_id = $1
      `, [s.id]);
      return { ...s, services: srvs };
    }));

    res.json({ ...salon, hours, services, staff: staffWithServices, photos, reviews });
  } catch (err) { next(err); }
});

// POST /api/salons — register new salon (owner)
router.post('/', authenticate, requireRole('owner'), async (req, res, next) => {
  try {
    const { name, description, address, city, lat, lng, category, phone, email, website } = req.body;
    if (!name) return res.status(400).json({ error: 'Salon name is required.' });

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();
    const { rows: [salon] } = await pool.query(`
      INSERT INTO salons (owner_id, name, slug, description, address, city, lat, lng, category, phone, email, website)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [req.user.id, name, slug, description, address, city, lat || 0, lng || 0, category || 'Hair', phone, email, website]);

    // Default hours: Mon-Fri 9-8, Sat 10-7, Sun closed
    for (let d = 0; d <= 6; d++) {
      const [open, close, closed] =
        d === 0 ? ['10:00', '17:00', 1] :
        d === 6 ? ['10:00', '19:00', 0] :
                  ['09:00', '20:00', 0];
      await pool.query(
        'INSERT INTO salon_hours (salon_id, day_of_week, open_time, close_time, is_closed) VALUES ($1,$2,$3,$4,$5)',
        [salon.id, d, open, close, closed]
      );
    }

    await pool.query(
      'INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, req.user.name, 'create', 'salon', salon.id, { name }]
    );

    res.status(201).json(salon);
  } catch (err) { next(err); }
});

// PATCH /api/salons/:id — update salon (owner or admin)
router.patch('/:id', authenticate, requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const { rows: [salon] } = await pool.query('SELECT * FROM salons WHERE id = $1', [req.params.id]);
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });
    if (req.user.role === 'owner' && salon.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your salon.' });
    }
    const { name, description, address, city, lat, lng, category, phone, email, website } = req.body;
    await pool.query(`
      UPDATE salons SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        address     = COALESCE($3, address),
        city        = COALESCE($4, city),
        lat         = COALESCE($5, lat),
        lng         = COALESCE($6, lng),
        category    = COALESCE($7, category),
        phone       = COALESCE($8, phone),
        email       = COALESCE($9, email),
        website     = COALESCE($10, website)
      WHERE id = $11
    `, [name, description, address, city, lat, lng, category, phone, email, website, salon.id]);

    await pool.query(
      'INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, req.user.name, 'update', 'salon', salon.id, { fields: Object.keys(req.body) }]
    );

    const { rows: [updated] } = await pool.query('SELECT * FROM salons WHERE id = $1', [salon.id]);
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/salons/:id/slots — available time slots
router.get('/:id/slots', async (req, res, next) => {
  try {
    const { date, service_ids, staff_id } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required.' });

    const { rows: [salon] } = await pool.query(
      "SELECT * FROM salons WHERE id = $1 AND status = 'approved'", [req.params.id]
    );
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    const dayOfWeek = new Date(date).getDay();
    const { rows: [hours] } = await pool.query(
      'SELECT * FROM salon_hours WHERE salon_id = $1 AND day_of_week = $2', [salon.id, dayOfWeek]
    );
    if (!hours || hours.is_closed) return res.json({ slots: [], closed: true });

    let totalDuration = 30;
    if (service_ids) {
      const ids = service_ids.split(',').map(Number).filter(Boolean);
      if (ids.length) {
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
        const { rows: [svc] } = await pool.query(
          `SELECT SUM(duration_min) AS total FROM services WHERE id IN (${placeholders}) AND salon_id = $1`,
          [salon.id, ...ids]
        );
        totalDuration = parseInt(svc?.total) || 30;
      }
    }

    const { rows: staffList } = staff_id
      ? await pool.query('SELECT * FROM staff WHERE id = $1 AND salon_id = $2 AND is_active = 1', [staff_id, salon.id])
      : await pool.query('SELECT * FROM staff WHERE salon_id = $1 AND is_active = 1', [salon.id]);

    const slots = [];
    let current = hours.open_time;
    const closeTime = hours.close_time;

    while (timeToMins(addMinutes(current, totalDuration)) <= timeToMins(closeTime)) {
      const slotEnd = addMinutes(current, totalDuration);

      for (const staffMember of staffList) {
        const { rows: [onLeave] } = await pool.query(
          'SELECT id FROM staff_leaves WHERE staff_id = $1 AND leave_date = $2', [staffMember.id, date]
        );
        if (onLeave) {
          slots.push({ time: current, end_time: slotEnd, staff_id: staffMember.id, staff_name: staffMember.name, available: false, reason: 'on_leave' });
          continue;
        }
        const { rows: [overlap] } = await pool.query(`
          SELECT id FROM bookings
          WHERE staff_id = $1 AND booking_date = $2
          AND status NOT IN ('cancelled')
          AND NOT (end_time <= $3 OR start_time >= $4)
        `, [staffMember.id, date, current, slotEnd]);

        slots.push({ time: current, end_time: slotEnd, staff_id: staffMember.id, staff_name: staffMember.name, available: !overlap });
      }
      current = addMinutes(current, 30);
    }

    res.json({ slots, total_duration: totalDuration, open: hours.open_time, close: hours.close_time });
  } catch (err) { next(err); }
});

module.exports = router;
