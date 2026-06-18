'use strict';
const express = require('express');
const pool    = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('owner'));

async function getOwnerSalon(userId) {
  const { rows: [salon] } = await pool.query(
    'SELECT * FROM salons WHERE owner_id = $1 LIMIT 1', [userId]
  );
  return salon;
}

// GET /api/owner/salon
router.get('/salon', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found for this owner.' });
    const [{ rows: hours }, { rows: photos }] = await Promise.all([
      pool.query('SELECT * FROM salon_hours WHERE salon_id = $1 ORDER BY day_of_week', [salon.id]),
      pool.query('SELECT * FROM salon_photos WHERE salon_id = $1 ORDER BY is_primary DESC, display_order', [salon.id]),
    ]);
    res.json({ ...salon, hours, photos });
  } catch (err) { next(err); }
});

// GET /api/owner/bookings
router.get('/bookings', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { date_from, date_to, status, staff_id } = req.query;

    const params = [salon.id];
    let where = 'WHERE b.salon_id = $1';
    if (date_from) { params.push(date_from); where += ` AND b.booking_date >= $${params.length}`; }
    if (date_to)   { params.push(date_to);   where += ` AND b.booking_date <= $${params.length}`; }
    if (status)    { params.push(status);     where += ` AND b.status = $${params.length}`; }
    if (staff_id)  { params.push(staff_id);   where += ` AND b.staff_id = $${params.length}`; }

    const { rows: bookings } = await pool.query(`
      SELECT b.*, u.name AS customer_name, u.phone AS customer_phone,
        st.name AS staff_name,
        COALESCE(
          json_agg(json_build_object(
            'name', bs.service_name_snapshot,
            'price', bs.price_snapshot,
            'duration', bs.duration_snapshot
          )) FILTER (WHERE bs.id IS NOT NULL),
          '[]'::json
        ) AS services
      FROM bookings b
      JOIN users u ON b.customer_id = u.id
      LEFT JOIN staff st ON b.staff_id = st.id
      LEFT JOIN booking_services bs ON bs.booking_id = b.id
      ${where}
      GROUP BY b.id, u.name, u.phone, st.name
      ORDER BY b.booking_date DESC, b.start_time DESC
    `, params);
    res.json(bookings);
  } catch (err) { next(err); }
});

// GET /api/owner/analytics
router.get('/analytics', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
    const today    = new Date().toISOString().split('T')[0];

    const [revenueData, bookingsByStatus, topServices, staffUtil, todayCount, monthRevenue, activeStaff, avgRating] =
      await Promise.all([
        pool.query(`
          SELECT booking_date AS date, SUM(total_price_snapshot) AS amount
          FROM bookings WHERE salon_id = $1 AND status IN ('completed','confirmed')
          AND booking_date >= $2 GROUP BY booking_date ORDER BY booking_date
        `, [salon.id, fromDate]),

        pool.query(`
          SELECT status, COUNT(*) AS count FROM bookings WHERE salon_id = $1
          GROUP BY status
        `, [salon.id]),

        pool.query(`
          SELECT bs.service_name_snapshot AS name, COUNT(*) AS count, SUM(bs.price_snapshot) AS revenue
          FROM booking_services bs JOIN bookings b ON bs.booking_id = b.id
          WHERE b.salon_id = $1 AND b.status NOT IN ('cancelled')
          GROUP BY bs.service_name_snapshot ORDER BY count DESC LIMIT 8
        `, [salon.id]),

        pool.query(`
          SELECT st.name AS staff_name, COUNT(b.id) AS booking_count,
            COALESCE(SUM(b.total_price_snapshot), 0) AS revenue
          FROM staff st LEFT JOIN bookings b ON b.staff_id = st.id AND b.status NOT IN ('cancelled')
          WHERE st.salon_id = $1 GROUP BY st.id, st.name ORDER BY booking_count DESC
        `, [salon.id]),

        pool.query(`
          SELECT COUNT(*) AS c FROM bookings
          WHERE salon_id = $1 AND booking_date = $2 AND status NOT IN ('cancelled')
        `, [salon.id, today]),

        pool.query(`
          SELECT COALESCE(SUM(total_price_snapshot), 0) AS rev FROM bookings
          WHERE salon_id = $1 AND status IN ('completed','confirmed') AND booking_date >= $2
        `, [salon.id, fromDate]),

        pool.query('SELECT COUNT(*) AS c FROM staff WHERE salon_id = $1 AND is_active = 1', [salon.id]),
        pool.query('SELECT COALESCE(AVG(rating), 0) AS avg FROM reviews WHERE salon_id = $1', [salon.id]),
      ]);

    const statusMap = {};
    bookingsByStatus.rows.forEach(r => { statusMap[r.status] = parseInt(r.count); });

    res.json({
      today_bookings:      parseInt(todayCount.rows[0].c),
      monthly_revenue:     parseFloat(monthRevenue.rows[0].rev),
      active_staff:        parseInt(activeStaff.rows[0].c),
      avg_rating:          Math.round(parseFloat(avgRating.rows[0].avg) * 10) / 10,
      revenue_last_30_days: revenueData.rows,
      bookings_by_status:  statusMap,
      top_services:        topServices.rows,
      staff_utilization:   staffUtil.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/owner/services
router.get('/services', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { rows } = await pool.query(
      'SELECT * FROM services WHERE salon_id = $1 ORDER BY category, name', [salon.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/owner/services
router.post('/services', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { name, description, category, price, duration_min, is_active } = req.body;
    if (!name || !price || !duration_min) return res.status(400).json({ error: 'name, price, duration_min required.' });
    const { rows: [svc] } = await pool.query(
      `INSERT INTO services (salon_id, name, description, category, price, duration_min, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [salon.id, name, description, category || 'Hair', price, duration_min, is_active !== false ? 1 : 0]
    );
    await pool.query(
      'INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, req.user.name, 'create', 'service', svc.id, { name, price }]
    );
    res.status(201).json(svc);
  } catch (err) { next(err); }
});

// PUT /api/owner/services/:id
router.put('/services/:id', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    const { rows: [svc] } = await pool.query(
      'SELECT * FROM services WHERE id = $1 AND salon_id = $2', [req.params.id, salon?.id]
    );
    if (!svc) return res.status(404).json({ error: 'Service not found.' });
    const { name, description, category, price, duration_min, is_active } = req.body;
    await pool.query(`
      UPDATE services SET
        name         = COALESCE($1, name),
        description  = COALESCE($2, description),
        category     = COALESCE($3, category),
        price        = COALESCE($4, price),
        duration_min = COALESCE($5, duration_min),
        is_active    = COALESCE($6, is_active)
      WHERE id = $7
    `, [name, description, category, price, duration_min,
        is_active !== undefined ? (is_active ? 1 : 0) : null, svc.id]);
    await pool.query(
      'INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, req.user.name, 'update', 'service', svc.id, { old_price: svc.price, new_price: price || svc.price }]
    );
    const { rows: [updated] } = await pool.query('SELECT * FROM services WHERE id = $1', [svc.id]);
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/owner/services/:id (soft delete)
router.delete('/services/:id', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    const { rows: [svc] } = await pool.query(
      'SELECT id FROM services WHERE id = $1 AND salon_id = $2', [req.params.id, salon?.id]
    );
    if (!svc) return res.status(404).json({ error: 'Service not found.' });
    await pool.query('UPDATE services SET is_active = 0 WHERE id = $1', [svc.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/owner/staff
router.get('/staff', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { rows: staff } = await pool.query(
      'SELECT * FROM staff WHERE salon_id = $1 ORDER BY name', [salon.id]
    );
    const result = await Promise.all(staff.map(async s => {
      const { rows: services } = await pool.query(`
        SELECT sv.id, sv.name FROM staff_services ss
        JOIN services sv ON ss.service_id = sv.id WHERE ss.staff_id = $1
      `, [s.id]);
      return { ...s, services };
    }));
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/owner/staff
router.post('/staff', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { name, phone, email, bio, avatar_url, service_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });
    const { rows: [s] } = await pool.query(
      'INSERT INTO staff (salon_id, name, phone, email, bio, avatar_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [salon.id, name, phone, email, bio, avatar_url]
    );
    if (service_ids?.length) {
      for (const sid of service_ids) {
        await pool.query(
          'INSERT INTO staff_services (staff_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.id, sid]
        );
      }
    }
    await pool.query(
      'INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, req.user.name, 'create', 'staff', s.id, { name }]
    );
    res.status(201).json(s);
  } catch (err) { next(err); }
});

// PUT /api/owner/staff/:id
router.put('/staff/:id', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    const { rows: [s] } = await pool.query(
      'SELECT * FROM staff WHERE id = $1 AND salon_id = $2', [req.params.id, salon?.id]
    );
    if (!s) return res.status(404).json({ error: 'Staff not found.' });
    const { name, phone, email, bio, avatar_url, is_active, service_ids } = req.body;
    await pool.query(`
      UPDATE staff SET
        name       = COALESCE($1, name), phone  = COALESCE($2, phone),
        email      = COALESCE($3, email), bio   = COALESCE($4, bio),
        avatar_url = COALESCE($5, avatar_url),
        is_active  = COALESCE($6, is_active)
      WHERE id = $7
    `, [name, phone, email, bio, avatar_url, is_active !== undefined ? (is_active ? 1 : 0) : null, s.id]);
    if (service_ids !== undefined) {
      await pool.query('DELETE FROM staff_services WHERE staff_id = $1', [s.id]);
      for (const sid of service_ids) {
        await pool.query(
          'INSERT INTO staff_services (staff_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.id, sid]
        );
      }
    }
    const { rows: [updated] } = await pool.query('SELECT * FROM staff WHERE id = $1', [s.id]);
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/owner/staff/:id (soft delete)
router.delete('/staff/:id', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    const { rows: [s] } = await pool.query('SELECT id FROM staff WHERE id = $1 AND salon_id = $2', [req.params.id, salon?.id]);
    if (!s) return res.status(404).json({ error: 'Staff not found.' });
    await pool.query('UPDATE staff SET is_active = 0 WHERE id = $1', [s.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/owner/staff/:id/leaves
router.post('/staff/:id/leaves', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    const { rows: [s] } = await pool.query('SELECT * FROM staff WHERE id = $1 AND salon_id = $2', [req.params.id, salon?.id]);
    if (!s) return res.status(404).json({ error: 'Staff not found.' });
    const { leave_date, reason } = req.body;
    if (!leave_date) return res.status(400).json({ error: 'leave_date required.' });
    const { rows: [leave] } = await pool.query(
      'INSERT INTO staff_leaves (staff_id, leave_date, reason) VALUES ($1,$2,$3) RETURNING *',
      [s.id, leave_date, reason]
    );
    res.status(201).json(leave);
  } catch (err) { next(err); }
});

// GET /api/owner/staff/:id/leaves
router.get('/staff/:id/leaves', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    const { rows: [s] } = await pool.query('SELECT * FROM staff WHERE id = $1 AND salon_id = $2', [req.params.id, salon?.id]);
    if (!s) return res.status(404).json({ error: 'Staff not found.' });
    const { rows } = await pool.query('SELECT * FROM staff_leaves WHERE staff_id = $1 ORDER BY leave_date', [s.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// DELETE /api/owner/staff/:id/leaves/:leaveId
router.delete('/staff/:id/leaves/:leaveId', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM staff_leaves WHERE id = $1', [req.params.leaveId]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/owner/salon/hours
router.patch('/salon/hours', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { hours } = req.body;
    if (!Array.isArray(hours)) return res.status(400).json({ error: 'hours must be an array.' });
    for (const h of hours) {
      await pool.query(`
        INSERT INTO salon_hours (salon_id, day_of_week, open_time, close_time, is_closed)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(salon_id, day_of_week) DO UPDATE SET
          open_time = EXCLUDED.open_time,
          close_time = EXCLUDED.close_time,
          is_closed = EXCLUDED.is_closed
      `, [salon.id, h.day_of_week, h.open_time, h.close_time, h.is_closed ? 1 : 0]);
    }
    const { rows } = await pool.query('SELECT * FROM salon_hours WHERE salon_id = $1 ORDER BY day_of_week', [salon.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/owner/salon/photos
router.patch('/salon/photos', async (req, res, next) => {
  try {
    const salon = await getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { action, photo_id, url, caption, is_primary } = req.body;

    if (action === 'add') {
      if (!url) return res.status(400).json({ error: 'url required.' });
      if (is_primary) await pool.query('UPDATE salon_photos SET is_primary = 0 WHERE salon_id = $1', [salon.id]);
      const { rows: [photo] } = await pool.query(
        'INSERT INTO salon_photos (salon_id, url, caption, is_primary) VALUES ($1,$2,$3,$4) RETURNING *',
        [salon.id, url, caption, is_primary ? 1 : 0]
      );
      return res.status(201).json(photo);
    }
    if (action === 'delete') {
      await pool.query('DELETE FROM salon_photos WHERE id = $1 AND salon_id = $2', [photo_id, salon.id]);
      return res.json({ success: true });
    }
    if (action === 'set_primary') {
      await pool.query('UPDATE salon_photos SET is_primary = 0 WHERE salon_id = $1', [salon.id]);
      await pool.query('UPDATE salon_photos SET is_primary = 1 WHERE id = $1 AND salon_id = $2', [photo_id, salon.id]);
      return res.json({ success: true });
    }
    res.status(400).json({ error: 'action must be add, delete, or set_primary.' });
  } catch (err) { next(err); }
});

module.exports = router;
