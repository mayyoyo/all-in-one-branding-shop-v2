'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const cors = require('cors');
const Stripe = require('stripe');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'orders.sqlite'));
db.pragma('journal_mode = WAL');

// Create the base table first so a brand-new local database can be initialized.
db.exec(`CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  items_json TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  stripe_session_id TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  order_status TEXT NOT NULL DEFAULT 'awaiting_payment',
  artwork_json TEXT NOT NULL DEFAULT '[]'
)`);

// Safe schema upgrades for existing local databases.
const orderColumns = new Set(db.prepare('PRAGMA table_info(orders)').all().map(column => column.name));
if (!orderColumns.has('shipping_address_json')) db.exec("ALTER TABLE orders ADD COLUMN shipping_address_json TEXT");
if (!orderColumns.has('shipping_name')) db.exec("ALTER TABLE orders ADD COLUMN shipping_name TEXT");
if (!orderColumns.has('amount_total_cents')) db.exec("ALTER TABLE orders ADD COLUMN amount_total_cents INTEGER");
if (!orderColumns.has('shipping_cents')) db.exec("ALTER TABLE orders ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 0");
if (!orderColumns.has('tax_cents')) db.exec("ALTER TABLE orders ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0");
if (!orderColumns.has('delivery_method')) db.exec("ALTER TABLE orders ADD COLUMN delivery_method TEXT");
if (!orderColumns.has('email_sent_at')) db.exec("ALTER TABLE orders ADD COLUMN email_sent_at TEXT");

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const money = cents => (cents / 100).toFixed(2);

// Temporary tax simulation is strictly limited to Stripe TEST mode.
// It creates/applies a Stripe Tax Rate object to physical print-product line items
// so checkout totals, webhooks, order records and admin summaries can be tested.
// Never use this as a substitute for a confirmed tax registration in live mode.
const testTaxRatePercent = Number(process.env.STRIPE_TEST_TAX_RATE || 0);
const isStripeTestMode = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_'));
let testTaxRateIdPromise = null;
async function getTestTaxRateId() {
  if (!stripe || !isStripeTestMode || !(testTaxRatePercent > 0 && testTaxRatePercent <= 20)) return null;
  if (process.env.STRIPE_AUTOMATIC_TAX === 'true') throw new Error('Use either Stripe Automatic Tax or the temporary test tax simulation, not both.');
  if (!testTaxRateIdPromise) {
    testTaxRateIdPromise = (async () => {
      const existing = await stripe.taxRates.list({ active: true, limit: 100 });
      const match = existing.data.find(rate => rate.percentage === testTaxRatePercent && rate.inclusive === false && rate.description === `AIO TEST ONLY — ${testTaxRatePercent}% temporary checkout tax`);
      if (match) return match.id;
      const created = await stripe.taxRates.create({
        display_name: `Test tax (${testTaxRatePercent}%)`,
        description: `AIO TEST ONLY — ${testTaxRatePercent}% temporary checkout tax`,
        percentage: testTaxRatePercent,
        inclusive: false,
        country: 'US',
        state: 'VA',
        jurisdiction: 'Virginia (test only)'
      });
      return created.id;
    })().catch(error => { testTaxRateIdPromise = null; throw error; });
  }
  return testTaxRateIdPromise;
}
const tiers = {
  cards: { label: 'Business cards', prices: {50: 15, 100: 22, 250: 35, 500: 55}, unit: 0.16 },
  labels: { label: 'Paper product labels', prices: {50: 15, 100: 22, 250: 40, 500: 70}, unit: 0.18 },
  flyers: { label: 'Flyers', prices: {25: 15, 50: 22, 100: 35, 250: 65, 500: 110}, unit: 0.38 },
  menus: { label: 'Menus', prices: {25: 20, 50: 30, 100: 48, 250: 90, 500: 150}, unit: 0.52 },
  brochures: { label: 'Brochures', prices: {25: 30, 50: 45, 100: 70, 250: 135, 500: 225}, unit: 0.8 },
  waterproof_labels: { label: 'Waterproof product labels', prices: {50: 25, 100: 40, 250: 75, 500: 135}, unit: 0.33 },
  stickers: { label: 'Logo and packaging stickers', prices: {25: 12, 50: 18, 100: 28, 250: 50, 500: 85}, unit: 0.26 },
  photos: { label: 'Photo prints', prices: {10: 7, 25: 16, 50: 30, 100: 55}, unit: 0.42 },
  largephotos: { label: 'Large photo prints', prices: {5: 40, 10: 80, 25: 200, 50: 400}, unit: 2.8 },
  invitations: { label: 'Invitations and thank-you cards', prices: {25: 20, 50: 30, 100: 48, 250: 90, 500: 150}, unit: 0.52 }
};
const websitePlans = { landing: ['Landing page website', 350], small: ['Small business website (up to 5 pages)', 750], large: ['Website (up to 8 pages)', 1200], ecommerce: ['Basic ecommerce website', 1500] };
const sizeMult = { '3.5x2': 1, '2x2': .8, '2x3': 1, '3x3': 1.25, '4x6': 1.8, '5x7': 1.4, '8.5x11': 1.7, '11x14': 2.2, '11x17': 2.8, custom: 1.5 };
const materialMult = { economy: .8, standard: 1, premium: 1.3, waterproof: 1.45 };
const finishMult = { matte: 1, glossy: 1.08, laminated: 1.2 };
const designFees = { existing: 0, simple: 25, complex: 50 };
const shippingFees = { pickup: 0, standard: 8, priority: 18 };
const escapeHtml = value => String(value ?? '').replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char]));
async function sendPaidOrderEmail(orderId) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const row = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!row || row.email_sent_at || row.payment_status !== 'paid') return;
  const data = JSON.parse(row.items_json);
  const itemRows = (data.items || []).map(item => `<li><strong>${escapeHtml(item.label)}</strong> — ${escapeHtml(item.quantity || 1)} × ${escapeHtml(money(item.amount))}<br><small>${escapeHtml(item.description || '')}</small></li>`).join('');
  const shipping = row.shipping_address_json ? JSON.parse(row.shipping_address_json) : null;
  const address = shipping ? [row.shipping_name, shipping.line1, shipping.line2, shipping.city, shipping.state, shipping.postal_code, shipping.country].filter(Boolean).map(escapeHtml).join('<br>') : 'Local pickup / no shipping address collected';
  const html = `<h2>Thank you for your order, ${escapeHtml(row.customer_name)}!</h2><p>Your payment has been confirmed.</p><p><strong>Order:</strong> ${escapeHtml(row.id)}</p><h3>Items</h3><ul>${itemRows}</ul><p>Subtotal: $${money(row.subtotal_cents)}<br>Shipping: $${money(row.shipping_cents || 0)}<br>Tax: $${money(row.tax_cents || 0)}<br><strong>Total: $${money(row.amount_total_cents ?? (row.subtotal_cents + (row.shipping_cents || 0)))}</strong></p><h3>Delivery</h3><p>${escapeHtml(row.delivery_method || 'not-applicable')}<br>${address}</p><p>Questions? Reply to this email or contact allinonebrandingshop@gmail.com.</p>`;
  const payload = { from: process.env.EMAIL_FROM, to: [row.customer_email], subject: `Order ${row.id} confirmed — All-in-One Branding Shop`, html };
  if (process.env.ORDER_NOTIFICATION_EMAIL) payload.bcc = [process.env.ORDER_NOTIFICATION_EMAIL];
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Order email could not be sent (${response.status}).`);
  db.prepare('UPDATE orders SET email_sent_at=? WHERE id=? AND email_sent_at IS NULL').run(new Date().toISOString(), orderId);
}
function computeItem(raw) {
  const q = raw && raw.configuration ? raw.configuration : raw;
  if (!q || typeof q !== 'object') throw new Error('An order item is invalid.');
  if (q.product === 'design') throw new Error('Logo and label design requires a custom quote. Please submit a quote request before payment.');
  if (q.product === 'web' || q.web === true) {
    const plan = String(q.plan || '');
    if (plan === 'custom' || !websitePlans[plan]) throw new Error('Custom website projects need an approved quote before checkout.');
    const [label, dollars] = websitePlans[plan];
    return { label, description: `${label}; design/development service`, amount: Math.round(dollars * 100), shippingCents: 0, delivery: 'not-applicable', product: 'web', quantity: 1, plan };
  }
  const p = tiers[q.product];
  if (!p) throw new Error('A selected product is not available for online checkout.');
  const quantity = Number(q.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50000) throw new Error('Please enter a valid quantity.');
  let base;
  if (q.product === 'photos' || q.product === 'largephotos') {
    if (Object.prototype.hasOwnProperty.call(p.prices, quantity)) base = p.prices[quantity];
    else if (quantity < 10) base = Math.max(2, quantity * 0.8);
    else base = Math.max(p.prices[50] || p.unit * 10, quantity * p.unit);
  } else {
    base = Object.prototype.hasOwnProperty.call(p.prices, quantity) ? p.prices[quantity] : Math.max(20, quantity * p.unit);
  }
  const photo = q.product === 'photos' || q.product === 'largephotos';
  const photoSizes = { '4x6': 1, '5x7': 1.45, '8x10': 2.5, '8.5x11': 3, '11x14': 4.2, '13x19': 6, custom: 1.5 };
  const allowedPhotoSizes = q.product === 'largephotos' ? ['11x14', '13x19'] : ['4x6', '5x7', '8x10'];
  if (photo && !allowedPhotoSizes.includes(q.size)) throw new Error(q.product === 'largephotos' ? 'Large photo prints are available in 11x14 and 13x19 inches online.' : 'Choose 4x6, 5x7 or 8x10 inches for standard photo prints.');
  if (q.product === 'brochures' && !['bi-fold', 'tri-fold'].includes(q.foldType)) throw new Error('Please choose bi-fold or tri-fold for your brochure.');
  if (photo && !['color', 'bw'].includes(q.photoColor)) throw new Error('Please choose color or black-and-white photo printing.');
  if (photo && !['standard', 'high', 'premium'].includes(q.photoQuality)) throw new Error('Please choose a valid photo quality.');
  if (photo && !['borderless', 'white'].includes(q.photoBorder)) throw new Error('Please choose a valid photo border option.');
  const s = photo ? photoSizes[q.size] : (sizeMult[q.size] ?? 1);
  const m = materialMult[q.material] ?? 1;
  const f = finishMult[q.finish] ?? 1;
  const sides = ['cards', 'flyers', 'menus', 'brochures', 'invitations'].includes(q.product) && q.sides === 'double' ? 1.18 : 1;
  const photoQuality = photo ? ({ standard: 1, high: 1.25, premium: 1.55 }[q.photoQuality]) : 1;
  const photoColor = photo && q.photoColor === 'bw' ? 0.9 : 1;
  base = Math.round(base * s * m * f * sides * photoQuality * photoColor * 100) / 100;
  const design = designFees[q.design];
  if (design === undefined) throw new Error('Please choose a valid design option.');
  const shipping = shippingFees[q.delivery];
  if (shipping === undefined) throw new Error('Please choose a valid delivery option.');
  const amount = Math.round((base + design) * 100);
  const shippingCents = Math.round(shipping * 100);
  const detail = `${quantity} ${photo ? 'photo prints' : 'pieces'}; size ${String(q.size || 'standard')}; material ${String(q.material || 'standard')}; finish ${String(q.finish || 'matte')}; ${q.shape ? `shape ${String(q.shape)};` : ''}${photo ? `photo color ${q.photoColor}; quality ${q.photoQuality}; border ${q.photoBorder};` : `${String(q.sides || 'single')}-sided;`}${q.product === 'brochures' ? ` fold ${q.foldType};` : ''} design ${String(q.design)}; delivery ${String(q.delivery)}`;
  return { label: p.label, description: detail, amount, shippingCents, product: q.product, quantity, size: q.size, material: q.material, finish: q.finish, sides: q.sides, foldType: q.foldType, shape: q.shape, design: q.design, delivery: q.delivery, ...(photo ? { photoColor: q.photoColor, photoQuality: q.photoQuality, photoBorder: q.photoBorder } : {}) };
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});
const allowedExt = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.svg', '.ai', '.eps', '.psd']);
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!allowedExt.has(path.extname(file.originalname).toLowerCase())) return cb(new Error('Unsupported artwork file type. Use PDF, PNG, JPG, SVG, AI, EPS, or PSD.'));
    cb(null, true);
  }
});

// Stripe requires the unparsed request body to verify webhook signatures.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe webhook is not configured.');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (err) { return res.status(400).send(`Webhook signature verification failed: ${err.message}`); }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      const shipping = session.shipping_details || null;
      const addressJson = shipping?.address ? JSON.stringify(shipping.address) : null;
      db.prepare(`UPDATE orders SET payment_status='paid', order_status='paid',
        shipping_address_json=COALESCE(?, shipping_address_json),
        shipping_name=COALESCE(?, shipping_name),
        amount_total_cents=COALESCE(?, amount_total_cents),
        tax_cents=COALESCE(?, tax_cents)
        WHERE id=? AND stripe_session_id=?`).run(
          addressJson, shipping?.name || null, Number.isInteger(session.amount_total) ? session.amount_total : null, Number.isInteger(session.total_details?.amount_tax) ? session.total_details.amount_tax : 0,
          session.metadata?.orderId || '', session.id
        );
      try { await sendPaidOrderEmail(session.metadata?.orderId || ''); } catch (emailError) { console.error('Order confirmation email failed:', emailError.message); }
    }
  }
  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    db.prepare(`UPDATE orders SET payment_status='failed', order_status='payment_failed' WHERE id=? AND stripe_session_id=?`).run(session.metadata?.orderId || '', session.id);
  }
  res.json({ received: true });
});
const allowedOrigins = String(process.env.CORS_ORIGINS || 'https://allinonebrandingshop.com,https://www.allinonebrandingshop.com,http://localhost:5000,http://127.0.0.1:5000').split(',').map(x => x.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error('This website origin is not allowed by the server CORS policy.')); }, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));
app.get('/api/health', (_req, res) => res.json({ ok: true, stripeConfigured: Boolean(stripe) }));

app.post('/api/create-checkout-session', upload.array('artwork', 10), async (req, res) => {
  const files = req.files || [];
  let createdOrderId = null;
  try {
    if (!stripe) {
      for (const file of files) { try { fs.unlinkSync(file.path); } catch {} }
      return res.status(503).json({ error: 'Online payment is not configured yet. The shop owner must add Stripe settings before accepting payments.' });
    }
    const name = String(req.body.customerName || '').trim().slice(0, 120);
    const email = String(req.body.customerEmail || '').trim().slice(0, 254);
    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter your name and a valid email address before checkout.');
    let rawItems;
    try { rawItems = JSON.parse(req.body.cart || '[]'); } catch { throw new Error('The cart could not be read. Please refresh and try again.'); }
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 20) throw new Error('Your cart must contain between 1 and 20 items.');
    const items = rawItems.map(computeItem);
    const subtotalCents = items.reduce((sum, item) => sum + item.amount, 0);
    const shippingCents = items.reduce((sum, item) => sum + (item.shippingCents || 0), 0);
    const deliveryMethods = [...new Set(items.map(item => item.delivery).filter(method => method && method !== 'not-applicable'))];
    const deliveryMethod = deliveryMethods.length ? deliveryMethods.join(', ') : 'not-applicable';
    if (subtotalCents + shippingCents < 100 || subtotalCents + shippingCents > 10000000) throw new Error('The combined order total is outside the supported checkout range.');
    const orderId = `AIB-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    createdOrderId = orderId;
    const artwork = files.map(f => ({ originalName: f.originalname, storedName: f.filename, mimeType: f.mimetype, size: f.size }));
    const notes = String(req.body.notes || '').slice(0, 3000);
    const orderItems = items.map(item => ({ ...item, amount: item.amount, amountDisplay: money(item.amount), shippingDisplay: money(item.shippingCents || 0) }));
    db.prepare(`INSERT INTO orders (id, created_at, customer_name, customer_email, items_json, subtotal_cents, shipping_cents, delivery_method, artwork_json, order_status, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', 'pending')`).run(orderId, new Date().toISOString(), name, email, JSON.stringify({ items: orderItems, notes }), subtotalCents, shippingCents, deliveryMethod, JSON.stringify(artwork));
    const origin = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const frontendOrigin = process.env.FRONTEND_BASE_URL || origin;
    const testTaxRateId = await getTestTaxRateId();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      client_reference_id: orderId,
      metadata: { orderId },
      line_items: [
        ...items.map(item => ({
          price_data: { currency: 'usd', product_data: { name: item.label, description: item.description.slice(0, 500) }, unit_amount: item.amount },
          quantity: 1,
          // Temporary 6% tax is applied only to printed goods in Stripe TEST mode.
          // Web design/development services and the separately listed shipping line are excluded.
          ...(testTaxRateId && item.product !== 'web' ? { tax_rates: [testTaxRateId] } : {})
        })),
        ...(shippingCents > 0 ? [{ price_data: { currency: 'usd', product_data: { name: 'Shipping', description: `Delivery method: ${deliveryMethod}` }, unit_amount: shippingCents }, quantity: 1 }] : [])
      ],
      success_url: `${frontendOrigin}/payment-success.html?order_id=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendOrigin}/?checkout=cancelled#pricing`,
      ...(shippingCents > 0 ? { shipping_address_collection: { allowed_countries: ['US'] } } : {}),
      ...(process.env.STRIPE_AUTOMATIC_TAX === 'true' ? { billing_address_collection: 'auto', automatic_tax: { enabled: true } } : {})
    });
    db.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').run(session.id, orderId);
    res.json({ url: session.url, orderId });
  } catch (err) {
    if (createdOrderId) {
      try { db.prepare("UPDATE orders SET payment_status='failed', order_status='checkout_failed' WHERE id=? AND stripe_session_id IS NULL").run(createdOrderId); } catch {}
    }
    // Remove files if order creation failed before a session was created.
    for (const file of files) { try { fs.unlinkSync(file.path); } catch {} }
    res.status(400).json({ error: err.message || 'Could not start checkout.' });
  }
});

// Admin credentials are configured privately in .env / Render Environment.
// Do not hard-code real usernames, passwords, or tokens in source files.
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
app.post('/api/admin/login', (req, res) => {
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!expectedUsername || !expectedPassword || !adminToken) {
    return res.status(503).json({ error: 'Admin login is not configured. Set ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_TOKEN in the private environment.' });
  }
  if (!safeEqual(username, expectedUsername) || !safeEqual(password, expectedPassword)) {
    return res.status(401).json({ error: 'Incorrect admin username or password.' });
  }
  res.json({ token: adminToken, message: 'Admin login successful.' });
});
const CUSTOMER_ORDER_STATUSES = new Set(['paid','awaiting_customer_approval','approved_for_print','in_production','quality_check','ready_for_pickup','shipped','completed','on_hold']);
app.patch('/api/admin/orders/:id/status', (req, res) => {
  const expected = process.env.ADMIN_TOKEN;
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || !safeEqual(auth, expected)) return res.status(401).json({ error: 'Unauthorized. Please sign in again.' });
  const status = String(req.body?.status || '');
  if (!CUSTOMER_ORDER_STATUSES.has(status)) return res.status(400).json({ error: 'Choose a valid order status.' });
  const result = db.prepare("UPDATE orders SET order_status=? WHERE id=? AND payment_status='paid'").run(status, String(req.params.id || ''));
  if (!result.changes) return res.status(404).json({ error: 'Paid order not found. Payment must be confirmed before production status can be changed.' });
  res.json({ ok: true, order_id: req.params.id, order_status: status });
});
app.get('/api/track-order', (req, res) => {
  const orderId = String(req.query.order_id || '').trim();
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!orderId || !email || orderId.length > 100 || email.length > 254) return res.status(400).json({ error: 'Enter your order number and checkout email address.' });
  const row = db.prepare('SELECT id, created_at, payment_status, order_status, delivery_method FROM orders WHERE id=? AND lower(customer_email)=?').get(orderId, email);
  if (!row) return res.status(404).json({ error: 'We could not find an order matching those details. Check your order number and email address.' });
  res.set('Cache-Control', 'no-store');
  res.json({ order: { id: row.id, created_at: row.created_at, payment_status: row.payment_status, order_status: row.order_status, delivery_method: row.delivery_method || 'not-applicable' } });
});
app.get('/api/admin/orders', (req, res) => {
  const expected = process.env.ADMIN_TOKEN;
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || !safeEqual(auth, expected)) return res.status(401).json({ error: 'Unauthorized. Please sign in again.' });
  const rows = db.prepare('SELECT id, created_at, customer_name, customer_email, items_json, subtotal_cents, stripe_session_id, payment_status, order_status, artwork_json, shipping_address_json, shipping_name, amount_total_cents, shipping_cents, tax_cents, delivery_method FROM orders ORDER BY created_at DESC LIMIT 200').all();
  res.json({ orders: rows.map(row => ({
    ...row,
    items: JSON.parse(row.items_json),
    artwork: JSON.parse(row.artwork_json),
    shipping_address: row.shipping_address_json ? JSON.parse(row.shipping_address_json) : null,
    subtotal: money(row.subtotal_cents),
    shipping: money(row.shipping_cents || 0),
    tax: money(row.tax_cents || 0),
    delivery_method: row.delivery_method || 'not-applicable',
    total: money(row.amount_total_cents ?? (row.subtotal_cents + (row.shipping_cents || 0)))
  })) });
});

// Return customer-facing order details only after validating the Checkout Session with Stripe.
app.get('/api/order-confirmation', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payment verification is not configured.' });
    const orderId = String(req.query.order_id || '').trim();
    const sessionId = String(req.query.session_id || '').trim();
    if (!orderId || !sessionId || !sessionId.startsWith('cs_')) {
      return res.status(400).json({ error: 'The order reference or Stripe session is missing. Please use the link from your checkout.' });
    }
    const row = db.prepare('SELECT id, created_at, customer_name, customer_email, items_json, subtotal_cents, stripe_session_id, payment_status, order_status, shipping_address_json, shipping_name, amount_total_cents, shipping_cents, tax_cents, delivery_method FROM orders WHERE id=?').get(orderId);
    if (!row || row.stripe_session_id !== sessionId) return res.status(404).json({ error: 'We could not find this order. Please contact the shop with your order reference.' });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if ((session.metadata?.orderId || session.client_reference_id) !== orderId) return res.status(403).json({ error: 'This checkout session does not match the order.' });
    const paid = session.payment_status === 'paid';
    const shipping = session.shipping_details || null;
    if (paid) {
      db.prepare(`UPDATE orders SET payment_status='paid', order_status=CASE WHEN order_status IN ('awaiting_payment','paid') THEN 'paid' ELSE order_status END,
        shipping_address_json=COALESCE(?, shipping_address_json), shipping_name=COALESCE(?, shipping_name), amount_total_cents=COALESCE(?, amount_total_cents), tax_cents=COALESCE(?, tax_cents)
        WHERE id=? AND stripe_session_id=?`).run(
          shipping?.address ? JSON.stringify(shipping.address) : null,
          shipping?.name || null,
          Number.isInteger(session.amount_total) ? session.amount_total : null,
          Number.isInteger(session.total_details?.amount_tax) ? session.total_details.amount_tax : 0,
          orderId, sessionId
        );
      try { await sendPaidOrderEmail(orderId); } catch (emailError) { console.error('Order confirmation email failed:', emailError.message); }
    }
    const fresh = db.prepare('SELECT payment_status, order_status, shipping_address_json, shipping_name, amount_total_cents, shipping_cents, tax_cents, delivery_method FROM orders WHERE id=?').get(orderId);
    res.json({
      order: {
        id: row.id, created_at: row.created_at, customer_name: row.customer_name, customer_email: row.customer_email,
        items: JSON.parse(row.items_json).items || [], notes: JSON.parse(row.items_json).notes || '',
        subtotal: money(row.subtotal_cents), shipping: money(fresh.shipping_cents || 0), tax: money(fresh.tax_cents || 0), delivery_method: fresh.delivery_method || 'not-applicable', total: money(fresh.amount_total_cents ?? (row.subtotal_cents + (fresh.shipping_cents || 0))),
        payment_status: paid ? 'paid' : session.payment_status || fresh.payment_status,
        tax_calculated: Boolean(session.automatic_tax?.enabled || (session.total_details?.amount_tax || 0) > 0),
        order_status: paid ? fresh.order_status : 'awaiting_payment',
        shipping_name: fresh.shipping_name || shipping?.name || null,
        shipping_address: fresh.shipping_address_json ? JSON.parse(fresh.shipping_address_json) : shipping?.address || null
      }
    });
  } catch (err) {
    console.error('Order confirmation verification failed:', err.message);
    res.status(502).json({ error: 'We could not verify the order right now. Refresh this page in a moment or contact the shop.' });
  }
});
app.get('/success.html', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'success.html')));
app.get('/cancel.html', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'cancel.html')));
app.use((err, _req, res, _next) => {
  const status = err instanceof multer.MulterError ? 400 : 400;
  res.status(status).json({ error: err.message || 'Request could not be processed.' });
});
app.listen(PORT, () => console.log(`All-in-One Branding Shop server listening on port ${PORT}`));
