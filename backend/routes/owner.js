const express = require('express');
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('owner'));

// Helper: get owner's salon
function getOwnerSalon(userId) {
  return db.prepare('SELECT * FROM salons WHERE owner_id = ? LIMIT 1').get(userId);
}

// GET /api/owner/salon
router.get('/salon', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found for this owner.' });
    const hours = db.prepare('SELECT * FROM salon_hours WHERE salon_id = ? ORDER BY day_of_week').all(salon.id);
    const photos = db.prepare('SELECT * FROM salon_photos WHERE salon_id = ? ORDER BY is_primary DESC, display_order').all(salon.id);
    res.json({ ...salon, hours, photos });
  } catch (err) { next(err); }
});

// GET /api/owner/bookings
router.get('/bookings', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { date_from, date_to, status, staff_id } = req.query;

    let where = 'WHERE b.salon_id = ?';
    const params = [salon.id];
    if (date_from) { where += ' AND b.booking_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND b.booking_date <= ?'; params.push(date_to); }
    if (status) { where += ' AND b.status = ?'; params.push(status); }
    if (staff_id) { where += ' AND b.staff_id = ?'; params.push(staff_id); }

    const bookings = db.prepare(`
      SELECT b.*, u.name AS customer_name, u.phone AS customer_phone,
        st.name AS staff_name,
        (SELECT json_group_array(json_object('name', bs.service_name_snapshot, 'price', bs.price_snapshot, 'duration', bs.duration_snapshot))
         FROM booking_services bs WHERE bs.booking_id = b.id) AS services_json
      FROM bookings b
      JOIN users u ON b.customer_id = u.id
      LEFT JOIN staff st ON b.staff_id = st.id
      ${where}
      ORDER BY b.booking_date DESC, b.start_time DESC
    `).all(...params);

    res.json(bookings.map(b => ({ ...b, services: JSON.parse(b.services_json || '[]'), services_json: undefined })));
  } catch (err) { next(err); }
});

// GET /api/owner/analytics
router.get('/analytics', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const revenueData = db.prepare(`
      SELECT booking_date AS date, SUM(total_price_snapshot) AS amount
      FROM bookings WHERE salon_id = ? AND status IN ('completed','confirmed')
      AND booking_date >= ? GROUP BY booking_date ORDER BY booking_date
    `).all(salon.id, fromDate);

    const bookingsByStatus = db.prepare(`
      SELECT status, COUNT(*) AS count FROM bookings WHERE salon_id = ?
      GROUP BY status
    `).all(salon.id);
    const statusMap = {};
    bookingsByStatus.forEach(r => { statusMap[r.status] = r.count; });

    const topServices = db.prepare(`
      SELECT bs.service_name_snapshot AS name, COUNT(*) AS count, SUM(bs.price_snapshot) AS revenue
      FROM booking_services bs JOIN bookings b ON bs.booking_id = b.id
      WHERE b.salon_id = ? AND b.status NOT IN ('cancelled')
      GROUP BY bs.service_name_snapshot ORDER BY count DESC LIMIT 8
    `).all(salon.id);

    const staffUtil = db.prepare(`
      SELECT st.name AS staff_name, COUNT(b.id) AS booking_count, COALESCE(SUM(b.total_price_snapshot), 0) AS revenue
      FROM staff st LEFT JOIN bookings b ON b.staff_id = st.id AND b.status NOT IN ('cancelled')
      WHERE st.salon_id = ? GROUP BY st.id ORDER BY booking_count DESC
    `).all(salon.id);

    const todayCount = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE salon_id = ? AND booking_date = ? AND status NOT IN ('cancelled')").get(salon.id, today);
    const monthRevenue = db.prepare(`SELECT COALESCE(SUM(total_price_snapshot),0) AS rev FROM bookings WHERE salon_id = ? AND status IN ('completed','confirmed') AND booking_date >= ?`).get(salon.id, fromDate);
    const activeStaff = db.prepare('SELECT COUNT(*) AS c FROM staff WHERE salon_id = ? AND is_active = 1').get(salon.id);
    const avgRating = db.prepare('SELECT COALESCE(AVG(rating), 0) AS avg FROM reviews WHERE salon_id = ?').get(salon.id);

    res.json({
      today_bookings: todayCount.c,
      monthly_revenue: monthRevenue.rev,
      active_staff: activeStaff.c,
      avg_rating: Math.round(avgRating.avg * 10) / 10,
      revenue_last_30_days: revenueData,
      bookings_by_status: statusMap,
      top_services: topServices,
      staff_utilization: staffUtil,
    });
  } catch (err) { next(err); }
});

// GET /api/owner/services
router.get('/services', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    res.json(db.prepare('SELECT * FROM services WHERE salon_id = ? ORDER BY category, name').all(salon.id));
  } catch (err) { next(err); }
});

// POST /api/owner/services
router.post('/services', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { name, description, category, price, duration_min, is_active } = req.body;
    if (!name || !price || !duration_min) return res.status(400).json({ error: 'name, price, duration_min required.' });
    const result = db.prepare(
      'INSERT INTO services (salon_id, name, description, category, price, duration_min, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(salon.id, name, description, category || 'Hair', price, duration_min, is_active !== false ? 1 : 0);
    db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, 'create', 'service', result.lastInsertRowid, JSON.stringify({ name, price }));
    res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) { next(err); }
});

// PUT /api/owner/services/:id
router.put('/services/:id', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    const svc = db.prepare('SELECT * FROM services WHERE id = ? AND salon_id = ?').get(req.params.id, salon?.id);
    if (!svc) return res.status(404).json({ error: 'Service not found.' });
    const { name, description, category, price, duration_min, is_active } = req.body;
    db.prepare(`
      UPDATE services SET
        name = COALESCE(?, name), description = COALESCE(?, description),
        category = COALESCE(?, category), price = COALESCE(?, price),
        duration_min = COALESCE(?, duration_min),
        is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(name, description, category, price, duration_min, is_active !== undefined ? (is_active ? 1 : 0) : null, svc.id);
    db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, 'update', 'service', svc.id, JSON.stringify({ old_price: svc.price, new_price: price || svc.price }));
    res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(svc.id));
  } catch (err) { next(err); }
});

// DELETE /api/owner/services/:id (soft delete)
router.delete('/services/:id', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    const svc = db.prepare('SELECT * FROM services WHERE id = ? AND salon_id = ?').get(req.params.id, salon?.id);
    if (!svc) return res.status(404).json({ error: 'Service not found.' });
    db.prepare('UPDATE services SET is_active = 0 WHERE id = ?').run(svc.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/owner/staff
router.get('/staff', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const staff = db.prepare('SELECT * FROM staff WHERE salon_id = ? ORDER BY name').all(salon.id);
    const result = staff.map(s => {
      const services = db.prepare(`
        SELECT sv.id, sv.name FROM staff_services ss JOIN services sv ON ss.service_id = sv.id WHERE ss.staff_id = ?
      `).all(s.id);
      return { ...s, services };
    });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/owner/staff
router.post('/staff', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { name, phone, email, bio, avatar_url, service_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required.' });
    const result = db.prepare(
      'INSERT INTO staff (salon_id, name, phone, email, bio, avatar_url) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(salon.id, name, phone, email, bio, avatar_url);
    const staffId = result.lastInsertRowid;
    if (service_ids?.length) {
      const ins = db.prepare('INSERT OR IGNORE INTO staff_services (staff_id, service_id) VALUES (?, ?)');
      service_ids.forEach(sid => ins.run(staffId, sid));
    }
    db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, 'create', 'staff', staffId, JSON.stringify({ name }));
    res.status(201).json(db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId));
  } catch (err) { next(err); }
});

// PUT /api/owner/staff/:id
router.put('/staff/:id', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    const s = db.prepare('SELECT * FROM staff WHERE id = ? AND salon_id = ?').get(req.params.id, salon?.id);
    if (!s) return res.status(404).json({ error: 'Staff not found.' });
    const { name, phone, email, bio, avatar_url, is_active, service_ids } = req.body;
    db.prepare(`
      UPDATE staff SET name=COALESCE(?,name), phone=COALESCE(?,phone), email=COALESCE(?,email),
        bio=COALESCE(?,bio), avatar_url=COALESCE(?,avatar_url), is_active=COALESCE(?,is_active) WHERE id=?
    `).run(name, phone, email, bio, avatar_url, is_active !== undefined ? (is_active ? 1 : 0) : null, s.id);
    if (service_ids !== undefined) {
      db.prepare('DELETE FROM staff_services WHERE staff_id = ?').run(s.id);
      const ins = db.prepare('INSERT OR IGNORE INTO staff_services (staff_id, service_id) VALUES (?, ?)');
      service_ids.forEach(sid => ins.run(s.id, sid));
    }
    res.json(db.prepare('SELECT * FROM staff WHERE id = ?').get(s.id));
  } catch (err) { next(err); }
});

// POST /api/owner/staff/:id/leaves
router.post('/staff/:id/leaves', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    const s = db.prepare('SELECT * FROM staff WHERE id = ? AND salon_id = ?').get(req.params.id, salon?.id);
    if (!s) return res.status(404).json({ error: 'Staff not found.' });
    const { leave_date, reason } = req.body;
    if (!leave_date) return res.status(400).json({ error: 'leave_date required.' });
    const result = db.prepare('INSERT INTO staff_leaves (staff_id, leave_date, reason) VALUES (?, ?, ?)').run(s.id, leave_date, reason);
    res.status(201).json(db.prepare('SELECT * FROM staff_leaves WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) { next(err); }
});

// GET /api/owner/staff/:id/leaves
router.get('/staff/:id/leaves', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    const s = db.prepare('SELECT * FROM staff WHERE id = ? AND salon_id = ?').get(req.params.id, salon?.id);
    if (!s) return res.status(404).json({ error: 'Staff not found.' });
    res.json(db.prepare('SELECT * FROM staff_leaves WHERE staff_id = ? ORDER BY leave_date').all(s.id));
  } catch (err) { next(err); }
});

// DELETE /api/owner/staff/:id/leaves/:leaveId
router.delete('/staff/:id/leaves/:leaveId', (req, res, next) => {
  try {
    db.prepare('DELETE FROM staff_leaves WHERE id = ?').run(req.params.leaveId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/owner/salon/hours
router.patch('/salon/hours', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { hours } = req.body; // array of {day_of_week, open_time, close_time, is_closed}
    if (!Array.isArray(hours)) return res.status(400).json({ error: 'hours must be an array.' });
    const upsert = db.prepare(`
      INSERT INTO salon_hours (salon_id, day_of_week, open_time, close_time, is_closed)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(salon_id, day_of_week) DO UPDATE SET
        open_time = excluded.open_time, close_time = excluded.close_time, is_closed = excluded.is_closed
    `);
    hours.forEach(h => upsert.run(salon.id, h.day_of_week, h.open_time, h.close_time, h.is_closed ? 1 : 0));
    res.json(db.prepare('SELECT * FROM salon_hours WHERE salon_id = ? ORDER BY day_of_week').all(salon.id));
  } catch (err) { next(err); }
});

// PATCH /api/owner/salon/photos
router.patch('/salon/photos', (req, res, next) => {
  try {
    const salon = getOwnerSalon(req.user.id);
    if (!salon) return res.status(404).json({ error: 'No salon found.' });
    const { action, photo_id, url, caption, is_primary } = req.body;

    if (action === 'add') {
      if (!url) return res.status(400).json({ error: 'url required.' });
      if (is_primary) db.prepare('UPDATE salon_photos SET is_primary = 0 WHERE salon_id = ?').run(salon.id);
      const result = db.prepare('INSERT INTO salon_photos (salon_id, url, caption, is_primary) VALUES (?, ?, ?, ?)').run(salon.id, url, caption, is_primary ? 1 : 0);
      return res.status(201).json(db.prepare('SELECT * FROM salon_photos WHERE id = ?').get(result.lastInsertRowid));
    }
    if (action === 'delete') {
      db.prepare('DELETE FROM salon_photos WHERE id = ? AND salon_id = ?').run(photo_id, salon.id);
      return res.json({ success: true });
    }
    if (action === 'set_primary') {
      db.prepare('UPDATE salon_photos SET is_primary = 0 WHERE salon_id = ?').run(salon.id);
      db.prepare('UPDATE salon_photos SET is_primary = 1 WHERE id = ? AND salon_id = ?').run(photo_id, salon.id);
      return res.json({ success: true });
    }
    res.status(400).json({ error: 'action must be add, delete, or set_primary.' });
  } catch (err) { next(err); }
});

module.exports = router;
