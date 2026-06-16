const express = require('express');
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Haversine distance in km
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
router.get('/', (req, res, next) => {
  try {
    const { search, category, lat, lng, radius_km = 50, sort } = req.query;

    let salons = db.prepare(`
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
      GROUP BY s.id
    `).all();

    if (search) {
      const q = search.toLowerCase();
      salons = salons.filter(s =>
        s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    }
    if (category && category !== 'All') {
      salons = salons.filter(s => s.category === category);
    }
    if (lat && lng) {
      const userLat = parseFloat(lat), userLng = parseFloat(lng);
      salons = salons.map(s => ({
        ...s,
        distance_km: haversine(userLat, userLng, s.lat, s.lng)
      })).filter(s => s.distance_km <= parseFloat(radius_km));
    }
    if (sort === 'rating') salons.sort((a, b) => b.avg_rating - a.avg_rating);
    else if (sort === 'nearest' && lat) salons.sort((a, b) => (a.distance_km || 0) - (b.distance_km || 0));

    res.json(salons);
  } catch (err) { next(err); }
});

// GET /api/salons/:id — full salon profile
router.get('/:id', (req, res, next) => {
  try {
    const salon = db.prepare(`
      SELECT s.*, u.name AS owner_name, u.email AS owner_email,
        COALESCE(AVG(r.rating), 0) AS avg_rating,
        COUNT(DISTINCT r.id) AS review_count
      FROM salons s
      LEFT JOIN users u ON s.owner_id = u.id
      LEFT JOIN reviews r ON r.salon_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    const hours = db.prepare('SELECT * FROM salon_hours WHERE salon_id = ? ORDER BY day_of_week').all(salon.id);
    const services = db.prepare('SELECT * FROM services WHERE salon_id = ? AND is_active = 1 ORDER BY category, name').all(salon.id);
    const staff = db.prepare('SELECT * FROM staff WHERE salon_id = ? AND is_active = 1').all(salon.id);
    const photos = db.prepare('SELECT * FROM salon_photos WHERE salon_id = ? ORDER BY is_primary DESC, display_order').all(salon.id);
    const reviews = db.prepare(`
      SELECT r.*, u.name AS customer_name
      FROM reviews r JOIN users u ON r.customer_id = u.id
      WHERE r.salon_id = ? ORDER BY r.created_at DESC LIMIT 10
    `).all(salon.id);

    // Attach services to each staff
    const staffWithServices = staff.map(s => {
      const srvs = db.prepare(`
        SELECT sv.id, sv.name FROM staff_services ss
        JOIN services sv ON ss.service_id = sv.id
        WHERE ss.staff_id = ?
      `).all(s.id);
      return { ...s, services: srvs };
    });

    res.json({ ...salon, hours, services, staff: staffWithServices, photos, reviews });
  } catch (err) { next(err); }
});

// POST /api/salons — register new salon (owner)
router.post('/', authenticate, requireRole('owner'), (req, res, next) => {
  try {
    const { name, description, address, city, lat, lng, category, phone, email, website } = req.body;
    if (!name) return res.status(400).json({ error: 'Salon name is required.' });

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();
    const result = db.prepare(`
      INSERT INTO salons (owner_id, name, slug, description, address, city, lat, lng, category, phone, email, website)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, name, slug, description, address, city, lat || 0, lng || 0, category || 'Hair', phone, email, website);

    const salon = db.prepare('SELECT * FROM salons WHERE id = ?').get(result.lastInsertRowid);

    // Default hours Mon-Fri 9-8, Sat 10-7, Sun closed
    const insertHours = db.prepare('INSERT INTO salon_hours (salon_id, day_of_week, open_time, close_time, is_closed) VALUES (?, ?, ?, ?, ?)');
    for (let d = 0; d <= 6; d++) {
      if (d === 0) insertHours.run(salon.id, d, '10:00', '17:00', 1);
      else if (d === 6) insertHours.run(salon.id, d, '10:00', '19:00', 0);
      else insertHours.run(salon.id, d, '09:00', '20:00', 0);
    }

    db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, 'create', 'salon', salon.id, JSON.stringify({ name }));

    res.status(201).json(salon);
  } catch (err) { next(err); }
});

// PATCH /api/salons/:id — update salon (owner)
router.patch('/:id', authenticate, requireRole('owner', 'admin'), (req, res, next) => {
  try {
    const salon = db.prepare('SELECT * FROM salons WHERE id = ?').get(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });
    if (req.user.role === 'owner' && salon.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your salon.' });
    }
    const { name, description, address, city, lat, lng, category, phone, email, website } = req.body;
    db.prepare(`
      UPDATE salons SET
        name = COALESCE(?, name), description = COALESCE(?, description),
        address = COALESCE(?, address), city = COALESCE(?, city),
        lat = COALESCE(?, lat), lng = COALESCE(?, lng),
        category = COALESCE(?, category), phone = COALESCE(?, phone),
        email = COALESCE(?, email), website = COALESCE(?, website)
      WHERE id = ?
    `).run(name, description, address, city, lat, lng, category, phone, email, website, salon.id);

    db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, req.user.name, 'update', 'salon', salon.id, JSON.stringify({ fields: Object.keys(req.body) }));

    res.json(db.prepare('SELECT * FROM salons WHERE id = ?').get(salon.id));
  } catch (err) { next(err); }
});

// GET /api/salons/:id/slots — get available time slots
router.get('/:id/slots', (req, res, next) => {
  try {
    const { date, service_ids, staff_id } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required.' });

    const salon = db.prepare("SELECT * FROM salons WHERE id = ? AND status = 'approved'").get(req.params.id);
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    const dayOfWeek = new Date(date).getDay();
    const hours = db.prepare('SELECT * FROM salon_hours WHERE salon_id = ? AND day_of_week = ?').get(salon.id, dayOfWeek);
    if (!hours || hours.is_closed) return res.json({ slots: [], closed: true });

    // Calculate total duration from selected services
    let totalDuration = 30;
    if (service_ids) {
      const ids = service_ids.split(',').map(Number).filter(Boolean);
      const services = db.prepare(`SELECT SUM(duration_min) as total FROM services WHERE id IN (${ids.map(() => '?').join(',')}) AND salon_id = ?`).get(...ids, salon.id);
      totalDuration = services?.total || 30;
    }

    // Get salon staff
    let staffList = staff_id
      ? db.prepare('SELECT * FROM staff WHERE id = ? AND salon_id = ? AND is_active = 1').all(staff_id, salon.id)
      : db.prepare('SELECT * FROM staff WHERE salon_id = ? AND is_active = 1').all(salon.id);

    const slots = [];
    let current = hours.open_time;
    const closeTime = hours.close_time;

    while (timeToMins(addMinutes(current, totalDuration)) <= timeToMins(closeTime)) {
      const slotEnd = addMinutes(current, totalDuration);

      for (const staffMember of staffList) {
        // Check if staff is on leave
        const onLeave = db.prepare('SELECT id FROM staff_leaves WHERE staff_id = ? AND leave_date = ?').get(staffMember.id, date);
        if (onLeave) {
          slots.push({ time: current, end_time: slotEnd, staff_id: staffMember.id, staff_name: staffMember.name, available: false, reason: 'on_leave' });
          continue;
        }

        // Check for overlapping bookings
        const overlap = db.prepare(`
          SELECT id FROM bookings
          WHERE staff_id = ? AND booking_date = ?
          AND status NOT IN ('cancelled')
          AND NOT (end_time <= ? OR start_time >= ?)
        `).get(staffMember.id, date, current, slotEnd);

        slots.push({
          time: current,
          end_time: slotEnd,
          staff_id: staffMember.id,
          staff_name: staffMember.name,
          available: !overlap,
        });
      }
      current = addMinutes(current, 30);
    }

    res.json({ slots, total_duration: totalDuration, open: hours.open_time, close: hours.close_time });
  } catch (err) { next(err); }
});

module.exports = router;
