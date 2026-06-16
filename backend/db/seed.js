const db = require('./database');
const bcrypt = require('bcryptjs');

function seed() {
  console.log('🌱 Seeding Urban HairPlaza database...\n');

  // ── Clear existing data (reverse FK order) ──────────────────────────────
  db.exec(`
    DELETE FROM audit_logs;
    DELETE FROM coupons;
    DELETE FROM reviews;
    DELETE FROM booking_services;
    DELETE FROM bookings;
    DELETE FROM staff_leaves;
    DELETE FROM staff_services;
    DELETE FROM staff;
    DELETE FROM services;
    DELETE FROM salon_hours;
    DELETE FROM salon_photos;
    DELETE FROM salons;
    DELETE FROM subscription_plans;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);

  // ── Subscription Plans ───────────────────────────────────────────────────
  const insertPlan = db.prepare(`
    INSERT INTO subscription_plans (name, price, max_staff, max_services, features_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertPlan.run('basic', 999, 5, 20, JSON.stringify(['Booking management','Service catalog','Staff profiles','Basic analytics']));
  insertPlan.run('pro', 2499, 15, 60, JSON.stringify(['All Basic features','Advanced analytics','Priority support','Gallery photos','Custom hours']));
  insertPlan.run('enterprise', 4999, 999, 999, JSON.stringify(['All Pro features','Unlimited staff & services','API access','Dedicated support','Commission negotiation']));
  console.log('✅ Subscription plans created');

  // ── Users ────────────────────────────────────────────────────────────────
  const hash = (p) => bcrypt.hashSync(p, 10);
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, phone)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Admin
  const adminId = insertUser.run('Platform Admin', 'admin@uhp.com', hash('Admin@123'), 'admin', '+91-9000000001').lastInsertRowid;

  // Owners
  const owner1Id = insertUser.run('Priya Sharma', 'owner1@test.com', hash('Owner@123'), 'owner', '+91-9811001100').lastInsertRowid;
  const owner2Id = insertUser.run('Rahul Mehta', 'owner2@test.com', hash('Owner@123'), 'owner', '+91-9811002200').lastInsertRowid;
  const owner3Id = insertUser.run('Ananya Iyer', 'owner3@test.com', hash('Owner@123'), 'owner', '+91-9811003300').lastInsertRowid;
  const owner4Id = insertUser.run('Vikram Nair', 'owner4@test.com', hash('Owner@123'), 'owner', '+91-9811004400').lastInsertRowid;

  // Customers
  const cust1Id = insertUser.run('Alice D\'Souza', 'alice@test.com', hash('Password@123'), 'customer', '+91-9900001111').lastInsertRowid;
  const cust2Id = insertUser.run('Bob Krishnan', 'bob@test.com', hash('Password@123'), 'customer', '+91-9900002222').lastInsertRowid;
  const cust3Id = insertUser.run('Carol Patel', 'carol@test.com', hash('Password@123'), 'customer', '+91-9900003333').lastInsertRowid;
  const cust4Id = insertUser.run('Dave Fernandez', 'dave@test.com', hash('Password@123'), 'customer', '+91-9900004444').lastInsertRowid;
  const cust5Id = insertUser.run('Eve Rajan', 'eve@test.com', hash('Password@123'), 'customer', '+91-9900005555').lastInsertRowid;
  const customers = [cust1Id, cust2Id, cust3Id, cust4Id, cust5Id];
  console.log('✅ Users created (1 admin, 4 owners, 5 customers)');

  // ── Salons ───────────────────────────────────────────────────────────────
  const insertSalon = db.prepare(`
    INSERT INTO salons (owner_id, name, slug, description, address, city, lat, lng, category, phone, email, website, status, commission_rate, subscription_plan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const salon1Id = insertSalon.run(
    owner1Id, 'Glamour Studio', 'glamour-studio',
    'Mumbai\'s premier luxury hair & beauty salon. Specializing in international hair coloring, keratin treatments, and bridal packages. Our award-winning stylists bring global trends to your doorstep.',
    '14, Hill Road, Bandra West', 'Mumbai', 19.0596, 72.8295,
    'Hair', '+91-22-26400100', 'hello@glamourstudio.in', 'https://glamourstudio.in',
    'approved', 12.0, 'pro'
  ).lastInsertRowid;

  const salon2Id = insertSalon.run(
    owner2Id, 'The Blade Barbers', 'the-blade-barbers',
    'Koramangala\'s finest gentlemen\'s grooming lounge. Straight-razor shaves, modern fades, beard sculpting, and hair treatments in a sophisticated, relaxed environment.',
    '80 Feet Road, 6th Block, Koramangala', 'Bangalore', 12.9279, 77.6271,
    'Barbershop', '+91-80-41234567', 'bookings@bladebarbers.com', 'https://bladebarbers.com',
    'approved', 10.0, 'pro'
  ).lastInsertRowid;

  const salon3Id = insertSalon.run(
    owner3Id, 'Serenity Spa & Salon', 'serenity-spa-salon',
    'Delhi\'s holistic wellness destination in the heart of Hauz Khas. Offering premium spa therapies, skin treatments, and salon services in a tranquil sanctuary.',
    'Village Lane, Hauz Khas', 'Delhi', 28.5494, 77.2001,
    'Spa & Wellness', '+91-11-46000200', 'info@serenityspa.in', 'https://serenityspa.in',
    'approved', 10.0, 'enterprise'
  ).lastInsertRowid;

  const salon4Id = insertSalon.run(
    owner4Id, 'NailArt Paradise', 'nailart-paradise',
    'Andheri\'s trendiest nail studio offering nail extensions, gel art, 3D nail designs, and manicure-pedicure treatments.',
    'MIDC Road, Andheri East', 'Mumbai', 19.1136, 72.8697,
    'Nail Studio', '+91-22-28001234', 'nails@nailartparadise.com', null,
    'pending', 10.0, 'basic'
  ).lastInsertRowid;

  console.log('✅ Salons created (3 approved, 1 pending)');

  // ── Salon Hours ──────────────────────────────────────────────────────────
  const insertHours = db.prepare(`
    INSERT INTO salon_hours (salon_id, day_of_week, open_time, close_time, is_closed)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const salonId of [salon1Id, salon2Id, salon3Id, salon4Id]) {
    for (let day = 0; day <= 6; day++) {
      if (day === 0) { // Sunday
        insertHours.run(salonId, day, '10:00', '17:00', 1);
      } else if (day === 6) { // Saturday
        insertHours.run(salonId, day, '10:00', '19:00', 0);
      } else { // Mon-Fri
        insertHours.run(salonId, day, '09:00', '20:00', 0);
      }
    }
  }
  console.log('✅ Salon hours created');

  // ── Photos ───────────────────────────────────────────────────────────────
  const insertPhoto = db.prepare(`
    INSERT INTO salon_photos (salon_id, url, caption, is_primary, display_order)
    VALUES (?, ?, ?, ?, ?)
  `);

  const salon1Photos = [
    ['https://images.unsplash.com/photo-1560066263-57e9a3d3c0ba?w=800&q=80', 'Main salon floor', 1, 1],
    ['https://images.unsplash.com/photo-1522337360846-a0b7e54b440a?w=800&q=80', 'Styling stations', 0, 2],
    ['https://images.unsplash.com/photo-1562322140-8baeececf3df?w=800&q=80', 'Color bar', 0, 3],
    ['https://images.unsplash.com/photo-1492106087820-71f1a00d2b11?w=800&q=80', 'Wash area', 0, 4],
  ];
  const salon2Photos = [
    ['https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=800&q=80', 'Barber chairs', 1, 1],
    ['https://images.unsplash.com/photo-1599351548779-c1e6f1de3ba4?w=800&q=80', 'Classic shave setup', 0, 2],
    ['https://images.unsplash.com/photo-1621605815971-a4f3b0ea2e77?w=800&q=80', 'Grooming products', 0, 3],
    ['https://images.unsplash.com/photo-1581683705068-ca8f49fc7f45?w=800&q=80', 'Barber at work', 0, 4],
  ];
  const salon3Photos = [
    ['https://images.unsplash.com/photo-1540555700478-4be2b3c2cf2e?w=800&q=80', 'Spa reception', 1, 1],
    ['https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=800&q=80', 'Massage room', 0, 2],
    ['https://images.unsplash.com/photo-1544161515-4be31d6f53e6?w=800&q=80', 'Facial treatment', 0, 3],
    ['https://images.unsplash.com/photo-1552693673-1bf958298935?w=800&q=80', 'Relaxation lounge', 0, 4],
  ];
  const salon4Photos = [
    ['https://images.unsplash.com/photo-1604654894610-df63bc536371?w=800&q=80', 'Nail studio', 1, 1],
    ['https://images.unsplash.com/photo-1604654894560-28a196f06e5e?w=800&q=80', 'Nail art examples', 0, 2],
  ];

  for (const [url, caption, isPrimary, order] of salon1Photos) insertPhoto.run(salon1Id, url, caption, isPrimary, order);
  for (const [url, caption, isPrimary, order] of salon2Photos) insertPhoto.run(salon2Id, url, caption, isPrimary, order);
  for (const [url, caption, isPrimary, order] of salon3Photos) insertPhoto.run(salon3Id, url, caption, isPrimary, order);
  for (const [url, caption, isPrimary, order] of salon4Photos) insertPhoto.run(salon4Id, url, caption, isPrimary, order);
  console.log('✅ Salon photos created');

  // ── Services ─────────────────────────────────────────────────────────────
  const insertService = db.prepare(`
    INSERT INTO services (salon_id, name, description, category, price, duration_min)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Glamour Studio services
  const s1_1 = insertService.run(salon1Id, 'Haircut & Blow Dry', 'Precision cut with professional blow-dry finish', 'Hair', 1200, 60).lastInsertRowid;
  const s1_2 = insertService.run(salon1Id, 'Global Hair Color', 'Full head color using ammonia-free premium color', 'Hair Color', 3500, 120).lastInsertRowid;
  const s1_3 = insertService.run(salon1Id, 'Highlights & Balayage', 'Freehand balayage or foil highlights', 'Hair Color', 5000, 180).lastInsertRowid;
  const s1_4 = insertService.run(salon1Id, 'Keratin Treatment', 'Smoothening & frizz control for silky hair', 'Hair Treatment', 6500, 150).lastInsertRowid;
  const s1_5 = insertService.run(salon1Id, 'Bridal Makeup', 'Complete bridal look with airbrush foundation', 'Makeup', 15000, 180).lastInsertRowid;
  const s1_6 = insertService.run(salon1Id, 'Facial & Cleanup', 'Deep cleansing facial with steam & mask', 'Skin', 2500, 90).lastInsertRowid;

  // The Blade Barbers services
  const s2_1 = insertService.run(salon2Id, 'Signature Haircut', 'Modern or classic cut with styling', 'Hair', 600, 45).lastInsertRowid;
  const s2_2 = insertService.run(salon2Id, 'Beard Trim & Shape', 'Precision beard sculpting and edge-up', 'Beard', 400, 30).lastInsertRowid;
  const s2_3 = insertService.run(salon2Id, 'Hot Towel Shave', 'Classic straight-razor shave with hot towel', 'Beard', 800, 45).lastInsertRowid;
  const s2_4 = insertService.run(salon2Id, 'Hair & Beard Combo', 'Haircut plus beard trim package', 'Combo', 900, 75).lastInsertRowid;
  const s2_5 = insertService.run(salon2Id, 'Scalp Treatment', 'Anti-dandruff & scalp massage therapy', 'Hair Treatment', 1200, 60).lastInsertRowid;
  const s2_6 = insertService.run(salon2Id, 'Hair Color', 'Natural or fashion shade coloring', 'Hair Color', 2000, 90).lastInsertRowid;

  // Serenity Spa services
  const s3_1 = insertService.run(salon3Id, 'Swedish Massage', 'Full body relaxation massage 60 min', 'Massage', 3500, 60).lastInsertRowid;
  const s3_2 = insertService.run(salon3Id, 'Deep Tissue Massage', 'Therapeutic massage for muscle tension', 'Massage', 4500, 75).lastInsertRowid;
  const s3_3 = insertService.run(salon3Id, 'Hydra Facial', 'Medical-grade skin resurfacing treatment', 'Skin', 5500, 90).lastInsertRowid;
  const s3_4 = insertService.run(salon3Id, 'Hair Spa', 'Nourishing hair mask with scalp massage', 'Hair', 2500, 60).lastInsertRowid;
  const s3_5 = insertService.run(salon3Id, 'Manicure & Pedicure', 'Complete hand and foot care combo', 'Nails', 2000, 90).lastInsertRowid;
  const s3_6 = insertService.run(salon3Id, 'Couple Spa Package', '2-hour couple massage + facial combo', 'Package', 9000, 120).lastInsertRowid;

  console.log('✅ Services created');

  // ── Staff ────────────────────────────────────────────────────────────────
  const insertStaff = db.prepare(`
    INSERT INTO staff (salon_id, name, phone, email, bio, avatar_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertStaffService = db.prepare(`INSERT INTO staff_services (staff_id, service_id) VALUES (?, ?)`);

  // Glamour Studio staff
  const st1_1 = insertStaff.run(salon1Id, 'Meera Kapoor', '+91-9812001001', 'meera@glamourstudio.in',
    'Senior stylist with 8 years experience. Specialist in balayage and bridal styling.', null).lastInsertRowid;
  const st1_2 = insertStaff.run(salon1Id, 'Rohan Joshi', '+91-9812001002', 'rohan@glamourstudio.in',
    'Color technician trained in Paris. Expert in creative coloring and keratin treatments.', null).lastInsertRowid;
  const st1_3 = insertStaff.run(salon1Id, 'Sunita Reddy', '+91-9812001003', 'sunita@glamourstudio.in',
    'Skin and makeup artist with 5 years of experience in bridal and party looks.', null).lastInsertRowid;

  for (const sid of [s1_1, s1_2]) insertStaffService.run(st1_1, sid);
  for (const sid of [s1_2, s1_3, s1_4]) insertStaffService.run(st1_2, sid);
  for (const sid of [s1_5, s1_6]) insertStaffService.run(st1_3, sid);

  // Blade Barbers staff
  const st2_1 = insertStaff.run(salon2Id, 'Arjun Singh', '+91-9812002001', 'arjun@bladebarbers.com',
    'Master barber with 10 years experience. Specializes in fades, tapers and beard artistry.', null).lastInsertRowid;
  const st2_2 = insertStaff.run(salon2Id, 'Dev Kumar', '+91-9812002002', 'dev@bladebarbers.com',
    'Traditional barber skilled in straight-razor shaves and classic gentleman\'s cuts.', null).lastInsertRowid;
  const st2_3 = insertStaff.run(salon2Id, 'Karan Malhotra', '+91-9812002003', 'karan@bladebarbers.com',
    'Hair color specialist and modern cuts expert. Trained at Toni & Guy.', null).lastInsertRowid;

  for (const sid of [s2_1, s2_2, s2_4]) insertStaffService.run(st2_1, sid);
  for (const sid of [s2_2, s2_3, s2_4]) insertStaffService.run(st2_2, sid);
  for (const sid of [s2_1, s2_5, s2_6]) insertStaffService.run(st2_3, sid);

  // Serenity Spa staff
  const st3_1 = insertStaff.run(salon3Id, 'Priyanka Das', '+91-9812003001', 'priyanka@serenityspa.in',
    'Certified massage therapist and wellness coach with 7 years experience.', null).lastInsertRowid;
  const st3_2 = insertStaff.run(salon3Id, 'Kavya Menon', '+91-9812003002', 'kavya@serenityspa.in',
    'Skin specialist and facial treatment expert. Certified in HydraFacial technology.', null).lastInsertRowid;
  const st3_3 = insertStaff.run(salon3Id, 'Neha Sharma', '+91-9812003003', 'neha@serenityspa.in',
    'Nail artist and beauty therapist specializing in complete body care treatments.', null).lastInsertRowid;

  for (const sid of [s3_1, s3_2, s3_6]) insertStaffService.run(st3_1, sid);
  for (const sid of [s3_3, s3_4]) insertStaffService.run(st3_2, sid);
  for (const sid of [s3_5, s3_4]) insertStaffService.run(st3_3, sid);

  console.log('✅ Staff and service assignments created');

  // ── Coupons ──────────────────────────────────────────────────────────────
  const insertCoupon = db.prepare(`
    INSERT INTO coupons (code, discount_type, discount_value, max_uses, uses_count)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertCoupon.run('DEMO10', 'percent', 10, 9999, 45);
  insertCoupon.run('DEMO20', 'percent', 20, 9999, 23);
  insertCoupon.run('FREEFIRST', 'percent', 100, 1, 0);
  insertCoupon.run('FLAT500', 'fixed', 500, 500, 12);
  console.log('✅ Coupons created');

  // ── Bookings & Reviews ───────────────────────────────────────────────────
  const insertBooking = db.prepare(`
    INSERT INTO bookings (customer_id, salon_id, staff_id, booking_date, start_time, end_time, status, total_price_snapshot, coupon_code, discount_amount, payment_method, payment_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBService = db.prepare(`
    INSERT INTO booking_services (booking_id, service_id, service_name_snapshot, price_snapshot, duration_snapshot)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertReview = db.prepare(`
    INSERT INTO reviews (booking_id, customer_id, salon_id, rating, comment)
    VALUES (?, ?, ?, ?, ?)
  `);

  const ref = () => 'UHP' + Date.now() + Math.floor(Math.random() * 1000);
  const today = new Date();
  const dateStr = (daysOffset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString().split('T')[0];
  };

  const bookingsData = [
    // Past completed bookings
    { cust: cust1Id, salon: salon1Id, staff: st1_1, date: dateStr(-30), start: '10:00', end: '11:00', status: 'completed', price: 1200, service: { id: s1_1, name: 'Haircut & Blow Dry', price: 1200, dur: 60 }, coupon: null, disc: 0, review: { rating: 5, comment: 'Meera is absolutely amazing! Best haircut I\'ve had in years.' } },
    { cust: cust2Id, salon: salon2Id, staff: st2_1, date: dateStr(-25), start: '11:00', end: '12:15', status: 'completed', price: 900, service: { id: s2_4, name: 'Hair & Beard Combo', price: 900, dur: 75 }, coupon: null, disc: 0, review: { rating: 5, comment: 'Arjun is a master. The fade is immaculate!' } },
    { cust: cust3Id, salon: salon3Id, staff: st3_1, date: dateStr(-20), start: '14:00', end: '15:00', status: 'completed', price: 3150, service: { id: s3_1, name: 'Swedish Massage', price: 3500, dur: 60 }, coupon: 'DEMO10', disc: 350, review: { rating: 4, comment: 'Very relaxing experience. Clean and serene environment.' } },
    { cust: cust4Id, salon: salon1Id, staff: st1_2, date: dateStr(-18), start: '15:00', end: '17:00', status: 'completed', price: 3500, service: { id: s1_2, name: 'Global Hair Color', price: 3500, dur: 120 }, coupon: null, disc: 0, review: { rating: 5, comment: 'Rohan transformed my hair! The color is stunning.' } },
    { cust: cust5Id, salon: salon2Id, staff: st2_2, date: dateStr(-15), start: '09:30', end: '10:15', status: 'completed', price: 800, service: { id: s2_3, name: 'Hot Towel Shave', price: 800, dur: 45 }, coupon: null, disc: 0, review: { rating: 5, comment: 'Traditional shave done to perfection. Highly recommend!' } },
    { cust: cust1Id, salon: salon3Id, staff: st3_2, date: dateStr(-14), start: '11:00', end: '12:30', status: 'completed', price: 4400, service: { id: s3_3, name: 'Hydra Facial', price: 5500, dur: 90 }, coupon: 'DEMO20', disc: 1100, review: { rating: 4, comment: 'My skin feels incredible. Will definitely return.' } },
    { cust: cust2Id, salon: salon1Id, staff: st1_3, date: dateStr(-12), start: '16:00', end: '17:30', status: 'completed', price: 2500, service: { id: s1_6, name: 'Facial & Cleanup', price: 2500, dur: 90 }, coupon: null, disc: 0, review: { rating: 3, comment: 'Good service but slightly delayed.' } },
    { cust: cust3Id, salon: salon2Id, staff: st2_3, date: dateStr(-10), start: '10:00', end: '11:30', status: 'completed', price: 2000, service: { id: s2_6, name: 'Hair Color', price: 2000, dur: 90 }, coupon: null, disc: 0, review: { rating: 5, comment: 'Karan does amazing color work. Very professional.' } },
    { cust: cust4Id, salon: salon3Id, staff: st3_3, date: dateStr(-8), start: '13:00', end: '14:30', status: 'completed', price: 2000, service: { id: s3_5, name: 'Manicure & Pedicure', price: 2000, dur: 90 }, coupon: null, disc: 0, review: { rating: 4, comment: 'Neat and clean service. Neha is very skilled.' } },
    { cust: cust5Id, salon: salon1Id, staff: st1_1, date: dateStr(-7), start: '12:00', end: '15:00', status: 'completed', price: 4500, service: { id: s1_3, name: 'Highlights & Balayage', price: 5000, dur: 180 }, coupon: 'DEMO10', disc: 500, review: { rating: 5, comment: 'Absolutely love the balayage! Meera is a genius.' } },
    { cust: cust1Id, salon: salon2Id, staff: st2_1, date: dateStr(-5), start: '15:00', end: '15:45', status: 'completed', price: 600, service: { id: s2_1, name: 'Signature Haircut', price: 600, dur: 45 }, coupon: null, disc: 0, review: { rating: 5, comment: 'Consistent quality every time!' } },
    { cust: cust2Id, salon: salon3Id, staff: st3_1, date: dateStr(-4), start: '10:00', end: '11:15', status: 'completed', price: 4050, service: { id: s3_2, name: 'Deep Tissue Massage', price: 4500, dur: 75 }, coupon: 'DEMO10', disc: 450, review: { rating: 5, comment: 'Best deep tissue massage in Delhi. Priyanka is incredible!' } },
    // No-show
    { cust: cust3Id, salon: salon1Id, staff: st1_2, date: dateStr(-6), start: '11:00', end: '13:30', status: 'no_show', price: 6500, service: { id: s1_4, name: 'Keratin Treatment', price: 6500, dur: 150 }, coupon: null, disc: 0, review: null },
    // Cancelled
    { cust: cust4Id, salon: salon2Id, staff: st2_2, date: dateStr(-9), start: '14:00', end: '14:45', status: 'cancelled', price: 800, service: { id: s2_3, name: 'Hot Towel Shave', price: 800, dur: 45 }, coupon: null, disc: 0, review: null },
    // Upcoming confirmed
    { cust: cust1Id, salon: salon1Id, staff: st1_1, date: dateStr(1), start: '10:00', end: '11:00', status: 'confirmed', price: 1200, service: { id: s1_1, name: 'Haircut & Blow Dry', price: 1200, dur: 60 }, coupon: null, disc: 0, review: null },
    { cust: cust2Id, salon: salon2Id, staff: st2_1, date: dateStr(2), start: '11:00', end: '12:15', status: 'confirmed', price: 810, service: { id: s2_4, name: 'Hair & Beard Combo', price: 900, dur: 75 }, coupon: 'DEMO10', disc: 90, review: null },
    { cust: cust3Id, salon: salon3Id, staff: st3_2, date: dateStr(3), start: '14:00', end: '15:30', status: 'confirmed', price: 5500, service: { id: s3_3, name: 'Hydra Facial', price: 5500, dur: 90 }, coupon: null, disc: 0, review: null },
    { cust: cust4Id, salon: salon1Id, staff: st1_3, date: dateStr(5), start: '15:00', end: '18:00', status: 'confirmed', price: 15000, service: { id: s1_5, name: 'Bridal Makeup', price: 15000, dur: 180 }, coupon: null, disc: 0, review: null },
    { cust: cust5Id, salon: salon2Id, staff: st2_3, date: dateStr(4), start: '10:00', end: '11:30', status: 'confirmed', price: 2000, service: { id: s2_6, name: 'Hair Color', price: 2000, dur: 90 }, coupon: null, disc: 0, review: null },
    { cust: cust1Id, salon: salon3Id, staff: st3_1, date: dateStr(7), start: '11:00', end: '13:00', status: 'confirmed', price: 8100, service: { id: s3_6, name: 'Couple Spa Package', price: 9000, dur: 120 }, coupon: 'DEMO10', disc: 900, review: null },
  ];

  for (const b of bookingsData) {
    const bookingId = insertBooking.run(
      b.cust, b.salon, b.staff, b.date, b.start, b.end,
      b.status, b.price, b.coupon, b.disc, 'upi', ref()
    ).lastInsertRowid;
    insertBService.run(bookingId, b.service.id, b.service.name, b.service.price, b.service.dur);
    if (b.review) {
      insertReview.run(bookingId, b.cust, b.salon, b.review.rating, b.review.comment);
    }
  }
  console.log(`✅ ${bookingsData.length} bookings created (with reviews)`);

  // ── Audit Logs ───────────────────────────────────────────────────────────
  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (actor_id, actor_name, action, entity_type, entity_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertAudit.run(adminId, 'Platform Admin', 'approve', 'salon', salon1Id, JSON.stringify({ salon: 'Glamour Studio', reason: 'Verified business documents' }));
  insertAudit.run(adminId, 'Platform Admin', 'approve', 'salon', salon2Id, JSON.stringify({ salon: 'The Blade Barbers', reason: 'Verified business documents' }));
  insertAudit.run(adminId, 'Platform Admin', 'approve', 'salon', salon3Id, JSON.stringify({ salon: 'Serenity Spa & Salon', reason: 'Verified business documents' }));
  insertAudit.run(owner1Id, 'Priya Sharma', 'update', 'salon', salon1Id, JSON.stringify({ field: 'description', action: 'updated salon description' }));
  insertAudit.run(owner2Id, 'Rahul Mehta', 'create', 'service', s2_6, JSON.stringify({ service: 'Hair Color', price: 2000 }));
  insertAudit.run(owner3Id, 'Ananya Iyer', 'update', 'service', s3_1, JSON.stringify({ field: 'price', old: 3000, new: 3500 }));
  insertAudit.run(adminId, 'Platform Admin', 'update', 'plan', 2, JSON.stringify({ plan: 'pro', field: 'price', old: 1999, new: 2499 }));
  insertAudit.run(owner4Id, 'Vikram Nair', 'create', 'salon', salon4Id, JSON.stringify({ salon: 'NailArt Paradise', status: 'pending' }));
  insertAudit.run(adminId, 'Platform Admin', 'create', 'coupon', 1, JSON.stringify({ code: 'DEMO10', type: 'percent', value: 10 }));
  insertAudit.run(owner1Id, 'Priya Sharma', 'create', 'staff', st1_3, JSON.stringify({ staff: 'Sunita Reddy' }));
  console.log('✅ Audit logs created');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n🎉 Database seeded successfully!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Seed Summary:');
  console.log('  👤 Users: 1 admin, 4 owners, 5 customers');
  console.log('  🏪 Salons: 3 approved, 1 pending');
  console.log('  💇 Services: 18 across 3 salons');
  console.log('  👥 Staff: 9 members across 3 salons');
  console.log(`  📅 Bookings: ${bookingsData.length} (past + upcoming)`);
  console.log('  ⭐ Reviews: 12');
  console.log('  🎟️  Coupons: DEMO10, DEMO20, FREEFIRST, FLAT500');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n🔑 Test Credentials:');
  console.log('  Admin:    admin@uhp.com    / Admin@123');
  console.log('  Owner:    owner1@test.com  / Owner@123');
  console.log('  Customer: alice@test.com   / Password@123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

seed();
