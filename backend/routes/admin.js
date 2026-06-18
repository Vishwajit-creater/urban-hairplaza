'use strict';
const express = require('express');
const pool    = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

// GET /api/admin/salons
router.get('/salons', async (req, res, next) => {
  try {
    const { status } = req.query;
    const params = [];
    const where = status ? `WHERE s.status = $${params.push(status)}` : '';
    const { rows } = await pool.query(`
      SELECT s.*, u.name AS owner_name, u.email AS owner_email,
        COUNT(DISTINCT b.id) AS total_bookings,
        COALESCE(AVG(r.rating), 0) AS avg_rating
      FROM salons s
      LEFT JOIN users u ON s.owner_id = u.id
      LEFT JOIN bookings b ON b.salon_id = s.id
      LEFT JOIN reviews r ON r.salon_id = s.id
      ${where}
      GROUP BY s.id, u.name, u.email
      ORDER BY s.created_at DESC
    `, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// PATCH /api/admin/salons/:id/status
router.patch('/salons/:id/status', async (req, res, next) => {
  try {
    const { status, reason } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved, rejected, or pending.' });
    }
    const { rows: [salon] } = await pool.query('SELECT * FROM salons WHERE id = $1', [req.params.id]);
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    await pool.query(
      'UPDATE salons SET status = $1, rejection_reason = $2 WHERE id = $3',
      [status, reason || null, salon.id]
    );
    await pool.query(
      'INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [req.user.id, req.user.name, `salon_${status}`, 'salon', salon.id,
       { salon_name: salon.name, reason: reason || null }, req.ip]
    );
    const { rows: [updated] } = await pool.query('SELECT * FROM salons WHERE id = $1', [salon.id]);
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/admin/analytics
router.get('/analytics', async (req, res, next) => {
  try {
    const [totals, pendingSalons, bookingsByDay, revenueBySalon] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM salons) AS total_salons,
          (SELECT COUNT(*) FROM salons WHERE status = 'approved') AS active_salons,
          (SELECT COUNT(*) FROM salons WHERE status = 'pending') AS pending_salons,
          (SELECT COUNT(*) FROM bookings) AS total_bookings,
          (SELECT COALESCE(SUM(total_price_snapshot), 0) FROM bookings WHERE status NOT IN ('cancelled')) AS total_revenue
      `),
      pool.query("SELECT COUNT(*) AS c FROM salons WHERE status = 'pending'"),
      pool.query(`
        SELECT booking_date AS date, COUNT(*) AS count
        FROM bookings
        WHERE booking_date >= (CURRENT_DATE - INTERVAL '30 days')
        GROUP BY booking_date ORDER BY booking_date
      `),
      pool.query(`
        SELECT s.name AS salon_name, s.commission_rate,
          COALESCE(SUM(b.total_price_snapshot), 0) AS revenue,
          COALESCE(SUM(b.total_price_snapshot * s.commission_rate / 100.0), 0) AS commission
        FROM salons s
        LEFT JOIN bookings b ON b.salon_id = s.id AND b.status NOT IN ('cancelled')
        WHERE s.status = 'approved'
        GROUP BY s.id, s.name, s.commission_rate
        ORDER BY revenue DESC
      `),
    ]);

    const t = totals.rows[0];
    const commissionEarned = revenueBySalon.rows.reduce((sum, r) => sum + parseFloat(r.commission), 0);

    res.json({
      total_salons:      parseInt(t.total_salons),
      active_salons:     parseInt(t.active_salons),
      pending_salons:    parseInt(t.pending_salons),
      total_bookings:    parseInt(t.total_bookings),
      total_revenue:     parseFloat(t.total_revenue),
      commission_earned: Math.round(commissionEarned * 100) / 100,
      bookings_by_day:   bookingsByDay.rows,
      revenue_by_salon:  revenueBySalon.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const params = [];
    let where = '';
    if (req.query.actor_id)    { params.push(req.query.actor_id);    where += ` AND actor_id = $${params.length}`; }
    if (req.query.action)      { params.push(req.query.action);      where += ` AND action = $${params.length}`; }
    if (req.query.entity_type) { params.push(req.query.entity_type); where += ` AND entity_type = $${params.length}`; }

    const { rows: logs } = await pool.query(`
      SELECT * FROM audit_logs WHERE 1=1 ${where}
      ORDER BY created_at DESC LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}
    `, params);

    const countParams = params.slice(0, params.length - 2);
    const { rows: [total] } = await pool.query(
      `SELECT COUNT(*) AS c FROM audit_logs WHERE 1=1 ${where}`, countParams
    );
    res.json({ total: parseInt(total.c), page, limit, logs });
  } catch (err) { next(err); }
});

// GET /api/admin/plans
router.get('/plans', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM subscription_plans ORDER BY price');
    res.json(rows);
  } catch (err) { next(err); }
});

// PUT /api/admin/plans/:id
router.put('/plans/:id', async (req, res, next) => {
  try {
    const { name, price, max_staff, max_services, features_json, is_active } = req.body;
    await pool.query(`
      UPDATE subscription_plans SET
        name         = COALESCE($1, name),
        price        = COALESCE($2, price),
        max_staff    = COALESCE($3, max_staff),
        max_services = COALESCE($4, max_services),
        features_json = COALESCE($5, features_json),
        is_active    = COALESCE($6, is_active)
      WHERE id = $7
    `, [name, price, max_staff, max_services,
        features_json ? JSON.stringify(features_json) : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null, req.params.id]);
    const { rows: [plan] } = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [req.params.id]);
    res.json(plan);
  } catch (err) { next(err); }
});

// PUT /api/admin/salons/:id/commission
router.put('/salons/:id/commission', async (req, res, next) => {
  try {
    const { rate } = req.body;
    if (rate === undefined || rate < 0 || rate > 100) {
      return res.status(400).json({ error: 'rate must be between 0 and 100.' });
    }
    await pool.query('UPDATE salons SET commission_rate = $1 WHERE id = $2', [rate, req.params.id]);
    await pool.query(
      'INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, req.user.name, 'update_commission', 'salon', req.params.id, { rate }]
    );
    res.json({ success: true, commission_rate: rate });
  } catch (err) { next(err); }
});

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const { role } = req.query;
    const params = [];
    const where = role ? `WHERE role = $${params.push(role)}` : '';
    const { rows } = await pool.query(
      `SELECT id, name, email, role, phone, created_at FROM users ${where} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
