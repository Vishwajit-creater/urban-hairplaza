const express = require('express');
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// GET /api/admin/salons
router.get('/salons', (req, res, next) => {
  try {
    const { status, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND s.status = ?'; params.push(status); }
    if (search) { where += ' AND (s.name LIKE ? OR s.city LIKE ? OR u.name LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    const salons = db.prepare(`
      SELECT s.*, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone,
        (SELECT COUNT(*) FROM services WHERE salon_id = s.id AND is_active = 1) AS service_count,
        (SELECT COUNT(*) FROM staff WHERE salon_id = s.id AND is_active = 1) AS staff_count,
        (SELECT COUNT(*) FROM bookings WHERE salon_id = s.id) AS booking_count,
        (SELECT COALESCE(SUM(total_price_snapshot), 0) FROM bookings WHERE salon_id = s.id AND status NOT IN ('cancelled')) AS total_revenue,
        (SELECT url FROM salon_photos WHERE salon_id = s.id AND is_primary = 1 LIMIT 1) AS primary_photo,
        COALESCE((SELECT AVG(rating) FROM reviews WHERE salon_id = s.id), 0) AS avg_rating
      FROM salons s JOIN users u ON s.owner_id = u.id
      ${where}
      ORDER BY s.created_at DESC
    `).all(...params);
    res.json(salons);
  } catch (err) { next(err); }
});

// PATCH /api/admin/salons/:id/status
router.patch('/salons/:id/status', (req, res, next) => {
  try {
    const { status, reason } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved, rejected, or pending.' });
    }
    const salon = db.prepare('SELECT * FROM salons WHERE id = ?').get(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    db.prepare('UPDATE salons SET status = ?, rejection_reason = ? WHERE id = ?').run(status, reason || null, salon.id);
    db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, status === 'approved' ? 'approve' : 'reject', 'salon', salon.id,
        JSON.stringify({ salon: salon.name, status_from: salon.status, status_to: status, reason }));

    res.json({ id: salon.id, status, reason });
  } catch (err) { next(err); }
});

// PUT /api/admin/salons/:id/commission
router.put('/salons/:id/commission', (req, res, next) => {
  try {
    const { commission_rate } = req.body;
    if (commission_rate === undefined) return res.status(400).json({ error: 'commission_rate required.' });
    db.prepare('UPDATE salons SET commission_rate = ? WHERE id = ?').run(commission_rate, req.params.id);
    db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, 'update', 'salon', req.params.id, JSON.stringify({ field: 'commission_rate', value: commission_rate }));
    res.json({ success: true, commission_rate });
  } catch (err) { next(err); }
});

// GET /api/admin/analytics
router.get('/analytics', (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = thirtyDaysAgo.toISOString().split('T')[0];

    const totalSalons = db.prepare('SELECT COUNT(*) AS c FROM salons').get().c;
    const activeSalons = db.prepare("SELECT COUNT(*) AS c FROM salons WHERE status = 'approved'").get().c;
    const pendingSalons = db.prepare("SELECT COUNT(*) AS c FROM salons WHERE status = 'pending'").get().c;
    const totalBookings = db.prepare('SELECT COUNT(*) AS c FROM bookings').get().c;
    const todayBookings = db.prepare('SELECT COUNT(*) AS c FROM bookings WHERE booking_date = ?').get(today).c;
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_price_snapshot),0) AS r FROM bookings WHERE status NOT IN ('cancelled')").get().r;

    // Commission earned this month
    const commission = db.prepare(`
      SELECT COALESCE(SUM(b.total_price_snapshot * s.commission_rate / 100), 0) AS c
      FROM bookings b JOIN salons s ON b.salon_id = s.id
      WHERE b.status NOT IN ('cancelled') AND b.booking_date >= ?
    `).get(fromDate).c;

    const bookingsByDay = db.prepare(`
      SELECT booking_date AS date, COUNT(*) AS count
      FROM bookings WHERE booking_date >= ? AND booking_date <= ?
      GROUP BY booking_date ORDER BY booking_date
    `).all(fromDate, today);

    const revenueBySalon = db.prepare(`
      SELECT s.name AS salon_name, s.city,
        COUNT(b.id) AS booking_count,
        COALESCE(SUM(b.total_price_snapshot), 0) AS revenue,
        COALESCE(SUM(b.total_price_snapshot * s.commission_rate / 100), 0) AS commission,
        COALESCE(AVG(r.rating), 0) AS avg_rating
      FROM salons s
      LEFT JOIN bookings b ON b.salon_id = s.id AND b.status NOT IN ('cancelled')
      LEFT JOIN reviews r ON r.salon_id = s.id
      WHERE s.status = 'approved'
      GROUP BY s.id ORDER BY revenue DESC
    `).all();

    res.json({
      total_salons: totalSalons,
      active_salons: activeSalons,
      pending_salons: pendingSalons,
      total_bookings: totalBookings,
      today_bookings: todayBookings,
      total_revenue: totalRevenue,
      commission_this_month: Math.round(commission * 100) / 100,
      bookings_by_day: bookingsByDay,
      revenue_by_salon: revenueBySalon,
    });
  } catch (err) { next(err); }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', (req, res, next) => {
  try {
    const { page = 1, limit = 20, actor_id, action, entity_type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params = [];
    if (actor_id) { where += ' AND actor_id = ?'; params.push(actor_id); }
    if (action) { where += ' AND action = ?'; params.push(action); }
    if (entity_type) { where += ' AND entity_type = ?'; params.push(entity_type); }

    const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${where}`).get(...params).c;
    const logs = db.prepare(`
      SELECT al.*, u.role AS actor_role
      FROM audit_logs al LEFT JOIN users u ON al.actor_id = u.id
      ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    res.json({ logs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// GET /api/admin/plans
router.get('/plans', (req, res, next) => {
  try {
    res.json(db.prepare('SELECT * FROM subscription_plans ORDER BY price').all());
  } catch (err) { next(err); }
});

// PUT /api/admin/plans/:id
router.put('/plans/:id', (req, res, next) => {
  try {
    const { price, max_staff, max_services, features_json } = req.body;
    db.prepare(`
      UPDATE subscription_plans SET
        price = COALESCE(?, price),
        max_staff = COALESCE(?, max_staff),
        max_services = COALESCE(?, max_services),
        features_json = COALESCE(?, features_json)
      WHERE id = ?
    `).run(price, max_staff, max_services, features_json ? JSON.stringify(features_json) : null, req.params.id);
    db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, 'update', 'plan', req.params.id, JSON.stringify(req.body));
    res.json(db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(req.params.id));
  } catch (err) { next(err); }
});

// GET /api/admin/users
router.get('/users', (req, res, next) => {
  try {
    const { role } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (role) { where += ' AND role = ?'; params.push(role); }
    res.json(db.prepare(`SELECT id, name, email, role, phone, created_at FROM users ${where} ORDER BY created_at DESC`).all(...params));
  } catch (err) { next(err); }
});

module.exports = router;
