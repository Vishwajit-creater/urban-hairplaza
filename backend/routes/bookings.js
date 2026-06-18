'use strict';
const express = require('express');
const pool    = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Validate a coupon from the DB; returns { discount, coupon } or { error }
async function applyCoupon(code, subtotal) {
  const upper = code?.toUpperCase();
  const { rows: [dbCoupon] } = await pool.query(
    'SELECT * FROM coupons WHERE code = $1 AND is_active = 1', [upper]
  );
  if (!dbCoupon) return { error: 'Invalid or expired coupon code.' };
  if (dbCoupon.uses_count >= dbCoupon.max_uses) return { error: 'Coupon usage limit reached.' };
  if (dbCoupon.expires_at && new Date(dbCoupon.expires_at) < new Date()) return { error: 'Coupon has expired.' };
  if (subtotal < dbCoupon.min_booking_amount) return { error: `Minimum booking amount ₹${dbCoupon.min_booking_amount} required.` };
  const discount = dbCoupon.discount_type === 'percent'
    ? (subtotal * dbCoupon.discount_value / 100)
    : Math.min(dbCoupon.discount_value, subtotal);
  return { discount: Math.round(discount * 100) / 100, coupon: dbCoupon };
}

// POST /api/bookings — create booking
router.post('/', authenticate, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { salon_id, staff_id, booking_date, start_time, service_ids, coupon_code, notes, payment_method } = req.body;
    if (!salon_id || !booking_date || !start_time || !service_ids?.length) {
      return res.status(400).json({ error: 'salon_id, booking_date, start_time, and service_ids are required.' });
    }

    const { rows: [salon] } = await client.query(
      "SELECT * FROM salons WHERE id = $1 AND status = 'approved'", [salon_id]
    );
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    // Fetch service rows and snapshot prices
    const placeholders = service_ids.map((_, i) => `$${i + 2}`).join(',');
    const { rows: serviceRows } = await client.query(
      `SELECT * FROM services WHERE id IN (${placeholders}) AND salon_id = $1 AND is_active = 1`,
      [salon_id, ...service_ids]
    );
    if (!serviceRows.length) return res.status(400).json({ error: 'No valid services found.' });

    const totalDuration = serviceRows.reduce((s, r) => s + r.duration_min, 0);
    const subtotal      = serviceRows.reduce((s, r) => s + parseFloat(r.price), 0);
    const end_time      = addMinutes(start_time, totalDuration);

    // Resolve staff
    let resolvedStaffId = staff_id || null;
    if (!resolvedStaffId) {
      const { rows: [anyStaff] } = await client.query(
        'SELECT id FROM staff WHERE salon_id = $1 AND is_active = 1 LIMIT 1', [salon_id]
      );
      resolvedStaffId = anyStaff?.id;
    }

    if (resolvedStaffId) {
      const { rows: [onLeave] } = await client.query(
        'SELECT id FROM staff_leaves WHERE staff_id = $1 AND leave_date = $2', [resolvedStaffId, booking_date]
      );
      if (onLeave) return res.status(409).json({ error: 'Selected staff member is on leave that day.' });

      const { rows: [overlap] } = await client.query(`
        SELECT id FROM bookings
        WHERE staff_id = $1 AND booking_date = $2
        AND status NOT IN ('cancelled')
        AND NOT (end_time <= $3 OR start_time >= $4)
      `, [resolvedStaffId, booking_date, start_time, end_time]);
      if (overlap) return res.status(409).json({ error: 'This time slot is already booked for the selected staff member.' });
    }

    // Apply coupon
    let discount = 0, appliedCoupon = null;
    if (coupon_code) {
      const result = await applyCoupon(coupon_code, subtotal);
      if (result.error) return res.status(400).json({ error: result.error });
      discount = result.discount;
      appliedCoupon = result.coupon;
      await client.query('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = $1', [appliedCoupon.id]);
    }

    const total       = Math.max(0, subtotal - discount);
    const payment_ref = 'UHP' + Date.now() + Math.floor(Math.random() * 9999);

    await client.query('BEGIN');

    const { rows: [booking] } = await client.query(`
      INSERT INTO bookings
        (customer_id, salon_id, staff_id, booking_date, start_time, end_time, notes,
         total_price_snapshot, coupon_code, discount_amount, payment_status, payment_ref, payment_method)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'paid',$11,$12)
      RETURNING *
    `, [req.user.id, salon_id, resolvedStaffId, booking_date, start_time, end_time, notes,
        total, coupon_code, discount, payment_ref, payment_method || 'upi']);

    for (const svc of serviceRows) {
      await client.query(
        `INSERT INTO booking_services
           (booking_id, service_id, service_name_snapshot, price_snapshot, duration_snapshot)
         VALUES ($1,$2,$3,$4,$5)`,
        [booking.id, svc.id, svc.name, svc.price, svc.duration_min]
      );
    }

    await client.query('COMMIT');

    const { rows: bServices } = await pool.query('SELECT * FROM booking_services WHERE booking_id = $1', [booking.id]);
    const staffInfo = resolvedStaffId
      ? (await pool.query('SELECT id, name FROM staff WHERE id = $1', [resolvedStaffId])).rows[0]
      : null;

    res.status(201).json({ ...booking, services: bServices, staff: staffInfo, salon: { id: salon.id, name: salon.name } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/bookings — customer's own bookings
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows: bookings } = await pool.query(`
      SELECT b.*, s.name AS salon_name, s.city AS salon_city,
        st.name AS staff_name,
        COALESCE(
          json_agg(json_build_object('name', bs.service_name_snapshot, 'price', bs.price_snapshot))
            FILTER (WHERE bs.id IS NOT NULL),
          '[]'::json
        ) AS services,
        (SELECT json_build_object('rating', r.rating, 'comment', r.comment)
         FROM reviews r WHERE r.booking_id = b.id) AS review
      FROM bookings b
      JOIN salons s ON b.salon_id = s.id
      LEFT JOIN staff st ON b.staff_id = st.id
      LEFT JOIN booking_services bs ON bs.booking_id = b.id
      WHERE b.customer_id = $1
      GROUP BY b.id, s.name, s.city, st.name
      ORDER BY b.booking_date DESC, b.start_time DESC
    `, [req.user.id]);
    res.json(bookings);
  } catch (err) { next(err); }
});

// GET /api/bookings/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows: [booking] } = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.customer_id !== req.user.id && req.user.role === 'customer') {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const [{ rows: services }, { rows: [salon] }, staffRes, { rows: [review] }] = await Promise.all([
      pool.query('SELECT * FROM booking_services WHERE booking_id = $1', [booking.id]),
      pool.query('SELECT id, name, address, city, phone FROM salons WHERE id = $1', [booking.salon_id]),
      booking.staff_id ? pool.query('SELECT id, name FROM staff WHERE id = $1', [booking.staff_id]) : { rows: [] },
      pool.query('SELECT * FROM reviews WHERE booking_id = $1', [booking.id]),
    ]);
    res.json({ ...booking, services, salon, staff: staffRes.rows[0] || null, review: review || null });
  } catch (err) { next(err); }
});

// PATCH /api/bookings/:id/status
router.patch('/:id/status', authenticate, async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['completed', 'no_show', 'cancelled', 'confirmed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }
    const { rows: [booking] } = await pool.query(`
      SELECT b.*, s.owner_id FROM bookings b
      JOIN salons s ON b.salon_id = s.id WHERE b.id = $1
    `, [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (req.user.role === 'customer' && booking.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (req.user.role === 'owner' && booking.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your salon.' });
    }
    await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, booking.id]);
    await pool.query(
      'INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, req.user.name, 'update', 'booking', booking.id, { status_from: booking.status, status_to: status }]
    );
    res.json({ id: booking.id, status });
  } catch (err) { next(err); }
});

// POST /api/bookings/:id/review
router.post('/:id/review', authenticate, async (req, res, next) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }
    const { rows: [booking] } = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND customer_id = $2', [req.params.id, req.user.id]
    );
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.status !== 'completed') return res.status(400).json({ error: 'Can only review completed bookings.' });

    const { rows: [existing] } = await pool.query('SELECT id FROM reviews WHERE booking_id = $1', [booking.id]);
    if (existing) return res.status(409).json({ error: 'Already reviewed this booking.' });

    const { rows: [review] } = await pool.query(
      'INSERT INTO reviews (booking_id, customer_id, salon_id, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [booking.id, req.user.id, booking.salon_id, rating, comment]
    );
    res.status(201).json(review);
  } catch (err) { next(err); }
});

module.exports = router;
