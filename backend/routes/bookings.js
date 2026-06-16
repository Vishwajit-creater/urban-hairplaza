const express = require('express');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Coupon validation
const DEMO_COUPONS = {
  DEMO10: { type: 'percent', value: 10 },
  DEMO20: { type: 'percent', value: 20 },
  FREEFIRST: { type: 'percent', value: 100 },
  FLAT500: { type: 'fixed', value: 500 },
};

function applyCoupon(code, subtotal) {
  const upper = code?.toUpperCase();
  // Check DB coupon
  const dbCoupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').get(upper);
  if (dbCoupon) {
    if (dbCoupon.uses_count >= dbCoupon.max_uses) return { error: 'Coupon usage limit reached.' };
    if (dbCoupon.expires_at && new Date(dbCoupon.expires_at) < new Date()) return { error: 'Coupon has expired.' };
    if (subtotal < dbCoupon.min_booking_amount) return { error: `Minimum booking amount ₹${dbCoupon.min_booking_amount} required.` };
    let discount = dbCoupon.discount_type === 'percent'
      ? (subtotal * dbCoupon.discount_value / 100)
      : Math.min(dbCoupon.discount_value, subtotal);
    return { discount: Math.round(discount * 100) / 100, coupon: dbCoupon };
  }
  return { error: 'Invalid or expired coupon code.' };
}

// POST /api/bookings — create booking
router.post('/', authenticate, (req, res, next) => {
  try {
    const { salon_id, staff_id, booking_date, start_time, service_ids, coupon_code, notes, payment_method } = req.body;
    if (!salon_id || !booking_date || !start_time || !service_ids?.length) {
      return res.status(400).json({ error: 'salon_id, booking_date, start_time, and service_ids are required.' });
    }

    const salon = db.prepare("SELECT * FROM salons WHERE id = ? AND status = 'approved'").get(salon_id);
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    // Fetch services and snapshot prices
    const serviceRows = db.prepare(
      `SELECT * FROM services WHERE id IN (${service_ids.map(() => '?').join(',')}) AND salon_id = ? AND is_active = 1`
    ).all(...service_ids, salon_id);
    if (serviceRows.length === 0) return res.status(400).json({ error: 'No valid services found.' });

    const totalDuration = serviceRows.reduce((sum, s) => sum + s.duration_min, 0);
    const subtotal = serviceRows.reduce((sum, s) => sum + s.price, 0);
    const end_time = addMinutes(start_time, totalDuration);

    // Resolve staff
    let resolvedStaffId = staff_id || null;
    if (!resolvedStaffId) {
      const anyStaff = db.prepare('SELECT id FROM staff WHERE salon_id = ? AND is_active = 1 LIMIT 1').get(salon_id);
      resolvedStaffId = anyStaff?.id;
    }

    // Check staff leave
    if (resolvedStaffId) {
      const onLeave = db.prepare('SELECT id FROM staff_leaves WHERE staff_id = ? AND leave_date = ?').get(resolvedStaffId, booking_date);
      if (onLeave) return res.status(409).json({ error: 'Selected staff member is on leave that day.' });

      // Double-booking check
      const overlap = db.prepare(`
        SELECT id FROM bookings
        WHERE staff_id = ? AND booking_date = ?
        AND status NOT IN ('cancelled')
        AND NOT (end_time <= ? OR start_time >= ?)
      `).get(resolvedStaffId, booking_date, start_time, end_time);
      if (overlap) return res.status(409).json({ error: 'This time slot is already booked for the selected staff member.' });
    }

    // Apply coupon
    let discount = 0;
    let appliedCoupon = null;
    if (coupon_code) {
      const result = applyCoupon(coupon_code, subtotal);
      if (result.error) return res.status(400).json({ error: result.error });
      discount = result.discount;
      appliedCoupon = result.coupon;
      // Increment coupon use count
      db.prepare('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ?').run(appliedCoupon.id);
    }

    const total = Math.max(0, subtotal - discount);
    const payment_ref = 'UHP' + Date.now() + Math.floor(Math.random() * 9999);

    const result = db.prepare(`
      INSERT INTO bookings (customer_id, salon_id, staff_id, booking_date, start_time, end_time, notes, total_price_snapshot, coupon_code, discount_amount, payment_status, payment_ref, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)
    `).run(req.user.id, salon_id, resolvedStaffId, booking_date, start_time, end_time, notes, total, coupon_code, discount, payment_ref, payment_method || 'upi');

    const bookingId = result.lastInsertRowid;

    // Insert booking services with price snapshot
    const insertBService = db.prepare(
      'INSERT INTO booking_services (booking_id, service_id, service_name_snapshot, price_snapshot, duration_snapshot) VALUES (?, ?, ?, ?, ?)'
    );
    for (const svc of serviceRows) {
      insertBService.run(bookingId, svc.id, svc.name, svc.price, svc.duration_min);
    }

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    const bServices = db.prepare('SELECT * FROM booking_services WHERE booking_id = ?').all(bookingId);
    const staff = resolvedStaffId ? db.prepare('SELECT id, name FROM staff WHERE id = ?').get(resolvedStaffId) : null;

    res.status(201).json({ ...booking, services: bServices, staff, salon: { id: salon.id, name: salon.name } });
  } catch (err) { next(err); }
});

// GET /api/bookings — customer's own bookings
router.get('/', authenticate, (req, res, next) => {
  try {
    const bookings = db.prepare(`
      SELECT b.*, s.name AS salon_name, s.city AS salon_city,
        st.name AS staff_name,
        (SELECT json_group_array(json_object('name', bs.service_name_snapshot, 'price', bs.price_snapshot)) FROM booking_services bs WHERE bs.booking_id = b.id) AS services_json,
        (SELECT json_object('rating', r.rating, 'comment', r.comment) FROM reviews r WHERE r.booking_id = b.id) AS review_json
      FROM bookings b
      JOIN salons s ON b.salon_id = s.id
      LEFT JOIN staff st ON b.staff_id = st.id
      WHERE b.customer_id = ?
      ORDER BY b.booking_date DESC, b.start_time DESC
    `).all(req.user.id);

    const result = bookings.map(b => ({
      ...b,
      services: JSON.parse(b.services_json || '[]'),
      review: b.review_json ? JSON.parse(b.review_json) : null,
      services_json: undefined,
      review_json: undefined,
    }));

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/bookings/:id
router.get('/:id', authenticate, (req, res, next) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.customer_id !== req.user.id && req.user.role === 'customer') {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const services = db.prepare('SELECT * FROM booking_services WHERE booking_id = ?').all(booking.id);
    const salon = db.prepare('SELECT id, name, address, city, phone FROM salons WHERE id = ?').get(booking.salon_id);
    const staff = booking.staff_id ? db.prepare('SELECT id, name FROM staff WHERE id = ?').get(booking.staff_id) : null;
    const review = db.prepare('SELECT * FROM reviews WHERE booking_id = ?').get(booking.id);
    res.json({ ...booking, services, salon, staff, review });
  } catch (err) { next(err); }
});

// PATCH /api/bookings/:id/status — owner or admin updates status
router.patch('/:id/status', authenticate, (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['completed', 'no_show', 'cancelled', 'confirmed'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });

    const booking = db.prepare(`
      SELECT b.*, s.owner_id FROM bookings b JOIN salons s ON b.salon_id = s.id WHERE b.id = ?
    `).get(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });

    if (req.user.role === 'customer' && booking.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (req.user.role === 'owner' && booking.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your salon.' });
    }

    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, booking.id);
    db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, 'update', 'booking', booking.id, JSON.stringify({ status_from: booking.status, status_to: status }));

    res.json({ id: booking.id, status });
  } catch (err) { next(err); }
});

// POST /api/bookings/:id/review
router.post('/:id/review', authenticate, (req, res, next) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND customer_id = ?').get(req.params.id, req.user.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.status !== 'completed') return res.status(400).json({ error: 'Can only review completed bookings.' });

    const existing = db.prepare('SELECT id FROM reviews WHERE booking_id = ?').get(booking.id);
    if (existing) return res.status(409).json({ error: 'Already reviewed this booking.' });

    const result = db.prepare(
      'INSERT INTO reviews (booking_id, customer_id, salon_id, rating, comment) VALUES (?, ?, ?, ?, ?)'
    ).run(booking.id, req.user.id, booking.salon_id, rating, comment);

    res.status(201).json(db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) { next(err); }
});

module.exports = router;
