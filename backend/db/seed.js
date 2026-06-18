'use strict';
/**
 * Seed script for Supabase PostgreSQL.
 *
 * Run once after setting up the schema:
 *   DATABASE_URL=postgres://... node backend/db/seed.js
 *
 * WARNING: This clears all existing data first.
 * Run in development / staging only.
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

const pool = new Pool({
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

const HASH = (pw) => bcrypt.hashSync(pw, 10);

async function seed() {
  const client = await pool.connect();
  try {
    console.log('\n🌱 Seeding Urban HairPlaza database (Supabase)...\n');
    await client.query('BEGIN');

    // ── Clear in reverse FK order ──────────────────────────────────────────
    await client.query('DELETE FROM audit_logs');
    await client.query('DELETE FROM coupons');
    await client.query('DELETE FROM subscription_plans');
    await client.query('DELETE FROM reviews');
    await client.query('DELETE FROM booking_services');
    await client.query('DELETE FROM bookings');
    await client.query('DELETE FROM staff_leaves');
    await client.query('DELETE FROM staff_services');
    await client.query('DELETE FROM staff');
    await client.query('DELETE FROM services');
    await client.query('DELETE FROM salon_hours');
    await client.query('DELETE FROM salon_photos');
    await client.query('DELETE FROM salons');
    await client.query('DELETE FROM users');

    // ── Subscription Plans ─────────────────────────────────────────────────
    await client.query(`
      INSERT INTO subscription_plans (name, price, max_staff, max_services, features_json, is_active)
      VALUES
        ('basic',      999,  5,  20, $1, 1),
        ('pro',       2499, 15,  60, $2, 1),
        ('enterprise',4999, -1, -1,  $3, 1)
    `, [
      JSON.stringify(['5 staff', '20 services', 'Basic analytics', 'Email support']),
      JSON.stringify(['15 staff', '60 services', 'Advanced analytics', 'Priority support', 'SMS notifications']),
      JSON.stringify(['Unlimited staff', 'Unlimited services', 'Full analytics suite', '24/7 support', 'API access', 'White-label']),
    ]);
    console.log('✅ Subscription plans created');

    // ── Users ──────────────────────────────────────────────────────────────
    const { rows: [admin] } = await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
      ['Super Admin', 'admin@uhp.com', HASH('Admin@123'), 'admin']
    );
    const ownerIds = [];
    for (const [i, o] of [
      ['Priya Sharma', 'owner1@test.com'],
      ['Rahul Verma',  'owner2@test.com'],
      ['Meera Nair',   'owner3@test.com'],
      ['Arjun Singh',  'owner4@test.com'],
    ].entries()) {
      const { rows: [u] } = await client.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id',
        [o[0], o[1], HASH('Owner@123'), 'owner']
      );
      ownerIds.push(u.id);
    }
    for (const [name, email] of [
      ['Alice Fernandes', 'alice@test.com'],
      ['Bob Mathur',      'bob@test.com'],
      ['Carol D\'Souza',  'carol@test.com'],
      ['Dave Kumar',      'dave@test.com'],
      ['Eve Chatterjee',  'eve@test.com'],
    ]) {
      await client.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)',
        [name, email, HASH('Password@123'), 'customer']
      );
    }
    console.log('✅ Users created (1 admin, 4 owners, 5 customers)');

    // ── Salons ─────────────────────────────────────────────────────────────
    const salonData = [
      { owner: ownerIds[0], name: 'Glamour Studio',        slug: 'glamour-studio',        city: 'Mumbai',    address: '12 Hill Rd, Bandra West',   lat: 19.0596, lng: 72.8295, cat: 'Hair & Beauty',  status: 'approved' },
      { owner: ownerIds[1], name: 'The Blade Barbers',     slug: 'the-blade-barbers',     city: 'Bangalore', address: '45 Koramangala 5th Block',   lat: 12.9279, lng: 77.6271, cat: 'Barbershop',    status: 'approved' },
      { owner: ownerIds[2], name: 'Serenity Spa & Salon',  slug: 'serenity-spa-salon',    city: 'Delhi',     address: '7 Hauz Khas Village',        lat: 28.5494, lng: 77.2001, cat: 'Spa & Wellness', status: 'approved' },
      { owner: ownerIds[3], name: 'NailArt Paradise',      slug: 'nailart-paradise',      city: 'Mumbai',    address: '33 Andheri West Main Road',  lat: 19.1136, lng: 72.8697, cat: 'Nail Studio',   status: 'pending'  },
    ];
    const salonIds = [];
    for (const s of salonData) {
      const { rows: [salon] } = await client.query(`
        INSERT INTO salons (owner_id, name, slug, description, address, city, lat, lng, category, phone, email, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
      `, [s.owner, s.name, s.slug,
          `Premium ${s.cat} salon providing top-quality services with expert stylists.`,
          s.address, s.city, s.lat, s.lng, s.cat,
          `+91-98${Math.floor(10000000 + Math.random() * 89999999)}`,
          `${s.slug}@example.com`, s.status]);
      salonIds.push(salon.id);
    }
    console.log('✅ Salons created (3 approved, 1 pending)');

    // ── Salon Hours ────────────────────────────────────────────────────────
    for (const sid of salonIds) {
      for (let d = 0; d <= 6; d++) {
        const [open, close, closed] = d === 0 ? ['10:00','17:00',1] : d === 6 ? ['10:00','19:00',0] : ['09:00','20:00',0];
        await client.query(
          'INSERT INTO salon_hours (salon_id, day_of_week, open_time, close_time, is_closed) VALUES ($1,$2,$3,$4,$5)',
          [sid, d, open, close, closed]
        );
      }
    }
    console.log('✅ Salon hours created');

    // ── Salon Photos ───────────────────────────────────────────────────────
    const photoSets = [
      ['1560066263-57e9a3d3c0ba','1522337360846-a0b7e54b440a','1562322140-8baeececf3df','1521590832167-7bcbef1d37af'],
      ['1503951914875-452162b0f3f1','1599351548779-c1e6f1de3ba4','1621605815971-a4f3b0ea2e77','1622288432119-3788d48ea5d7'],
      ['1540555700478-4be2b3c2cf2e','1570172619644-dfd03ed5d881','1544161515-4be31d6f53e6','1520271348865-a5f6de0ac8a3'],
      ['1604654894610-df63bc536371','1604654894610-df63bc536371','1583884944157-3a22dff5cc62','1604654894610-df63bc536371'],
    ];
    for (const [i, sid] of salonIds.entries()) {
      for (const [j, pid] of photoSets[i].entries()) {
        await client.query(
          'INSERT INTO salon_photos (salon_id, url, caption, is_primary, display_order) VALUES ($1,$2,$3,$4,$5)',
          [sid, `https://images.unsplash.com/photo-${pid}?w=800&q=80`, `Salon photo ${j + 1}`, j === 0 ? 1 : 0, j]
        );
      }
    }
    console.log('✅ Salon photos created');

    // ── Services ───────────────────────────────────────────────────────────
    const servicesData = [
      // Glamour Studio
      [salonIds[0], [
        { name: 'Haircut & Style',    cat: 'Hair',     price: 800,  dur: 60 },
        { name: 'Hair Colour (Full)', cat: 'Hair',     price: 2500, dur: 120 },
        { name: 'Balayage',           cat: 'Hair',     price: 4500, dur: 180 },
        { name: 'Keratin Treatment',  cat: 'Hair',     price: 5000, dur: 180 },
        { name: 'Bridal Makeup',      cat: 'Makeup',   price: 8000, dur: 120 },
        { name: 'Party Makeup',       cat: 'Makeup',   price: 3500, dur: 90 },
      ]],
      // The Blade Barbers
      [salonIds[1], [
        { name: 'Classic Haircut',    cat: 'Haircut',  price: 350,  dur: 30 },
        { name: 'Beard Trim & Shape', cat: 'Beard',    price: 250,  dur: 20 },
        { name: 'Hot Towel Shave',    cat: 'Shave',    price: 450,  dur: 45 },
        { name: 'Hair + Beard Combo', cat: 'Haircut',  price: 550,  dur: 50 },
        { name: 'Kids Haircut',       cat: 'Haircut',  price: 250,  dur: 20 },
      ]],
      // Serenity Spa
      [salonIds[2], [
        { name: 'Swedish Massage (60 min)', cat: 'Massage', price: 2500, dur: 60 },
        { name: 'Deep Tissue Massage',      cat: 'Massage', price: 3200, dur: 75 },
        { name: 'Ayurvedic Facial',         cat: 'Facial',  price: 1800, dur: 60 },
        { name: 'Anti-Ageing Facial',       cat: 'Facial',  price: 2800, dur: 75 },
        { name: 'Full Body Scrub',          cat: 'Body',    price: 4000, dur: 90 },
        { name: 'Aromatherapy Session',     cat: 'Wellness',price: 3500, dur: 90 },
      ]],
      // NailArt Paradise
      [salonIds[3], [
        { name: 'Basic Manicure',    cat: 'Manicure', price: 500,  dur: 40 },
        { name: 'Gel Manicure',      cat: 'Manicure', price: 1200, dur: 60 },
        { name: 'Basic Pedicure',    cat: 'Pedicure', price: 600,  dur: 45 },
        { name: 'Nail Art (per hand)',cat: 'Art',     price: 800,  dur: 60 },
      ]],
    ];
    const allServices = [];
    for (const [sid, svcs] of servicesData) {
      for (const svc of svcs) {
        const { rows: [s] } = await client.query(
          'INSERT INTO services (salon_id, name, category, price, duration_min) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [sid, svc.name, svc.cat, svc.price, svc.dur]
        );
        allServices.push({ id: s.id, salon_id: sid });
      }
    }
    console.log('✅ Services created');

    // ── Staff ──────────────────────────────────────────────────────────────
    const staffSets = [
      [salonIds[0], ['Kavya Reddy', 'Ritu Agarwal', 'Sonali Mehta']],
      [salonIds[1], ['Vikram Bose', 'Nikhil Joshi', 'Ajay Rawat']],
      [salonIds[2], ['Lakshmi Iyer', 'Priyanka Das', 'Ananya Roy']],
      [salonIds[3], ['Deepa Nair', 'Swati Gupta']],
    ];
    const allStaff = [];
    for (const [sid, names] of staffSets) {
      for (const name of names) {
        const { rows: [s] } = await client.query(
          'INSERT INTO staff (salon_id, name, bio, phone) VALUES ($1,$2,$3,$4) RETURNING id',
          [sid, name, `${name} is an expert stylist with 5+ years of experience.`, `+91-90${Math.floor(10000000 + Math.random() * 89999999)}`]
        );
        allStaff.push({ id: s.id, salon_id: sid });
        // Assign all services of that salon
        const salonSvcs = allServices.filter(sv => sv.salon_id === sid);
        for (const sv of salonSvcs) {
          await client.query(
            'INSERT INTO staff_services (staff_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.id, sv.id]
          );
        }
      }
    }
    console.log('✅ Staff and service assignments created');

    // ── Coupons ────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO coupons (code, discount_type, discount_value, min_booking_amount, max_uses, uses_count, is_active)
      VALUES
        ('DEMO10',    'percent', 10,    0,    1000, 0, 1),
        ('DEMO20',    'percent', 20,    1000, 500,  0, 1),
        ('FREEFIRST', 'percent', 100,   0,    1,    0, 1),
        ('FLAT500',   'fixed',   500,   2000, 200,  0, 1)
    `);
    console.log('✅ Coupons created');

    // ── Bookings & Reviews ─────────────────────────────────────────────────
    const customerIds = (await client.query("SELECT id FROM users WHERE role = 'customer' ORDER BY id")).rows.map(r => r.id);
    const approvedSalonIds = salonIds.slice(0, 3);
    const times = ['09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00'];
    let bookingCount = 0, reviewCount = 0;

    for (let dayOffset = -45; dayOffset <= 7; dayOffset++) {
      if (bookingCount >= 25) break;
      const d = new Date();
      d.setDate(d.getDate() + dayOffset);
      if (d.getDay() === 0) continue; // skip Sundays
      const dateStr = d.toISOString().split('T')[0];

      for (const sid of approvedSalonIds) {
        if (bookingCount >= 25) break;
        const salonStaff   = allStaff.filter(s => s.salon_id === sid);
        const salonSvcList = allServices.filter(s => s.salon_id === sid);
        if (!salonStaff.length || !salonSvcList.length) continue;

        const staffMember = salonStaff[bookingCount % salonStaff.length];
        const svc         = salonSvcList[bookingCount % salonSvcList.length];
        const svcRow      = (await client.query('SELECT * FROM services WHERE id = $1', [svc.id])).rows[0];
        const customer    = customerIds[bookingCount % customerIds.length];
        const time        = times[bookingCount % times.length];
        const endTime     = `${String(parseInt(time.split(':')[0]) + 1).padStart(2,'0')}:${time.split(':')[1]}`;
        const isPast      = dayOffset < 0;
        const status      = isPast ? (Math.random() > 0.2 ? 'completed' : 'no_show') : 'confirmed';
        const payRef      = 'UHP' + Date.now() + bookingCount;

        const { rows: [booking] } = await client.query(`
          INSERT INTO bookings
            (customer_id, salon_id, staff_id, booking_date, start_time, end_time,
             status, total_price_snapshot, payment_status, payment_ref, payment_method)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'paid',$9,'upi') RETURNING id
        `, [customer, sid, staffMember.id, dateStr, time, endTime, status, svcRow.price, payRef]);

        await client.query(
          'INSERT INTO booking_services (booking_id, service_id, service_name_snapshot, price_snapshot, duration_snapshot) VALUES ($1,$2,$3,$4,$5)',
          [booking.id, svc.id, svcRow.name, svcRow.price, svcRow.duration_min]
        );

        if (status === 'completed' && Math.random() > 0.3) {
          const rating = Math.floor(3 + Math.random() * 3);
          await client.query(
            'INSERT INTO reviews (booking_id, customer_id, salon_id, rating, comment) VALUES ($1,$2,$3,$4,$5)',
            [booking.id, customer, sid, rating, rating >= 4 ? 'Great experience!' : 'Good service overall.']
          );
          reviewCount++;
        }
        bookingCount++;
      }
    }
    console.log(`✅ ${bookingCount} bookings created (with ${reviewCount} reviews)`);

    // ── Audit Logs ─────────────────────────────────────────────────────────
    for (const [sid, action, entity] of [
      [salonIds[0], 'salon_approved', 'Glamour Studio'],
      [salonIds[1], 'salon_approved', 'The Blade Barbers'],
      [salonIds[2], 'salon_approved', 'Serenity Spa & Salon'],
    ]) {
      await client.query(
        'INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json) VALUES ($1,$2,$3,$4,$5,$6)',
        [admin.id, 'Super Admin', action, 'salon', sid, JSON.stringify({ salon_name: entity })]
      );
    }
    console.log('✅ Audit logs created');

    await client.query('COMMIT');

    console.log('\n🎉 Database seeded successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Seed Summary:');
    console.log(`  👤 Users: 1 admin, 4 owners, 5 customers`);
    console.log(`  🏪 Salons: 3 approved, 1 pending`);
    console.log(`  💇 Services: ${allServices.length} across 4 salons`);
    console.log(`  👥 Staff: ${allStaff.length} members`);
    console.log(`  📅 Bookings: ${bookingCount} (past + upcoming)`);
    console.log(`  ⭐ Reviews: ${reviewCount}`);
    console.log(`  🎟️  Coupons: DEMO10, DEMO20, FREEFIRST, FLAT500`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n🔑 Test Credentials:');
    console.log('  Admin:    admin@uhp.com    / Admin@123');
    console.log('  Owner:    owner1@test.com  / Owner@123');
    console.log('  Customer: alice@test.com   / Password@123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
