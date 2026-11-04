# All-in-One Branding Shop — Local + Production Deployment Package

A local Node.js + Express storefront for All-in-One Branding Shop. The brand system is designed around a distinctive A monogram and one consistent wordmark.

## Brand identity

- **Positioning:** Your complete branding and printing partner.
- **Tagline:** DESIGN • PRINT • BRAND.
- **Primary forest green:** `#174D36`.
- **Champagne gold:** `#C5A45A`.
- **Warm ivory:** `#F5F1E7`.
- **Charcoal:** `#252525`.
- **Brand assets:** `public/assets/` contains full-color, black, white and gold SVG wordmarks and symbol-only marks. Use the SVG files for clean scaling in websites and print layouts.
- **Print templates:** `public/brand-kit/` contains a business-card layout, invoice and print order form. Update any variable customer details before production. The business-card sample uses the standard US 3.5 × 2 inch size; add 0.125 inch bleed and preserve safe margins when preparing a commercial print file.

Use the full logo where there is room, and the A symbol alone on small labels, stickers, social avatars and compact spaces. Keep the logo independent of the customer's product artwork; it is the shop's identity, not a mandatory mark on customer designs.

## Included customer-facing services

- Business cards — single- or double-sided.
- Flyers, menus and bi-fold / tri-fold brochures.
- Paper product and packaging labels.
- Waterproof product labels (test the actual ink, vinyl and laminate combination before promising waterproof performance).
- Logo and packaging stickers.
- Invitations, thank-you cards and photo prints.
- Logo and label design (custom quote).
- Website design and development (custom quote or listed packages).

The cart supports multiple priced print products in one Stripe Checkout session. The server recalculates prices. Custom-quote services are not charged through the standard product checkout. Displayed prices are draft examples; verify material, ink, labor, waste, packaging, shipping, tax and profit before accepting real orders.

## Customer workflow included

1. Customer chooses a product, options and quantity.
2. Customer can upload existing artwork during checkout.
3. Shop reviews artwork for size, resolution, bleed, spelling and print readiness.
4. When a proof is required, the shop sends it to the customer and waits for written approval before printing.
5. Shop updates the order status as it moves through production and quality inspection.
6. Customer checks the latest status using `public/track-order.html`, their order number and checkout email.
7. Shop marks the order ready for pickup, shipped or completed.

**Important:** Proof delivery and approval are an operational step handled by the shop; this package does not automatically generate proofs, send approval links or collect a digital signature. The customer tracking page displays the latest status manually set by the shop in the admin orders page. Carrier tracking numbers are not integrated.

## Production deployment (IONOS + Render)

This updated package includes the frontend API routing for the current Render backend, including the storefront checkout, admin login/order management, order tracking and payment-success verification. It also includes `.env.example` and a production deployment checklist. See [`RENDER-DEPLOYMENT.md`](./RENDER-DEPLOYMENT.md) before deploying. Production secrets and customer databases are intentionally not included in this ZIP.

**Important:** Render needs a persistent disk for the SQLite database and customer artwork uploads. Back up existing production orders and files before changing storage paths or redeploying. Do not accept live payments until the persistent disk, live Stripe API key and matching live webhook secret have been configured and tested.

## Run locally on Windows

1. Install Node.js LTS (Node 20 or newer).
2. Extract this ZIP.
3. Open Command Prompt in the `All-in-One-Branding-Shop` folder (the folder containing `package.json`).
4. Run `npm install`.
5. Copy `.env.example` to `.env`. Leave Stripe values blank to browse the site and test non-payment pages; checkout requires Stripe configuration. Use Stripe TEST credentials locally, never live credentials.
6. Set strong private values for `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_TOKEN` in `.env` to use the admin page.
7. Run `npm start`.
8. Open `http://localhost:5000`.

Do not open `index.html` directly from File Explorer. Use the Express server. Admin orders are at `http://localhost:5000/admin.html`; order tracking is at `http://localhost:5000/track-order.html`.

## Optional local Stripe TEST checkout

Live payment processing is intentionally not configured in this local package. To test checkout locally, use Stripe **test-mode** credentials only:

1. Put your Stripe test secret key (`sk_test_...`) in `.env` as `STRIPE_SECRET_KEY`.
2. Install and sign in to the Stripe CLI.
3. In a second Command Prompt, run:

```bash
stripe listen --forward-to localhost:5000/api/stripe-webhook
```

4. Copy the webhook signing secret (`whsec_...`) printed by the CLI into `.env` as `STRIPE_WEBHOOK_SECRET`.
5. Restart `npm start`, then test checkout using Stripe test card details from Stripe's official testing documentation.
6. Keep the Stripe CLI listener running while testing. Without it, a successful Stripe test payment may not update the local order status immediately.

Never use live (`sk_live_...`) keys for local testing. Never share `.env` or commit it to GitHub.

## Admin order status workflow

After signing in at `/admin.html`, paid orders can be assigned one of these statuses:

- Paid / received
- Awaiting customer proof approval
- Approved for print
- In production
- Quality check
- Ready for pickup
- Shipped
- Completed
- On hold

The server rejects status changes for unpaid orders and validates each status value. Customers can view the current status at `/track-order.html` using their order number and the email used at checkout.

## Local data

Orders are stored in `data/orders.sqlite`; uploaded artwork is stored in `uploads/`. These are local files on this computer. Back them up if you need to keep local test orders.

## Production features that still require account setup

- Render service deployment, environment variables and persistent disk must be configured in your Render account.
- Live Stripe API credentials and a live webhook signing secret must be added privately in Render.
- Existing production database and uploads must be backed up and migrated to persistent storage before changing the live service.
- No live carrier shipping rates; delivery fees are example flat rates.
- Custom quote form requests are not automatically emailed to the shop.
- No automated proof creation, proof-approval portal, customer e-signature or carrier tracking integration.
- Prints larger than 13×19 inches require a print partner unless larger-format equipment is added.
- Waterproof performance must be validated with actual ink, vinyl, laminate and real-use testing.

## Tax and email

- `STRIPE_TEST_TAX_RATE=6` enables a clearly labelled **TEST-MODE-ONLY** 6% Stripe tax rate on printed-product line items when `STRIPE_SECRET_KEY` begins with `sk_test_`. It exists to test checkout totals, webhook tax capture, receipts and admin reporting. It is not a live tax configuration or a legal tax determination. Standalone web design/development services and the separately listed shipping line are excluded from this temporary test simulation.
- The test simulation is ignored with live Stripe keys. Do not set a guessed tax rate for real customers. After Virginia Tax corrects the EIN and confirms the registration, configure the matching Stripe Tax registration and product tax categories, remove `STRIPE_TEST_TAX_RATE`, and only then enable `STRIPE_AUTOMATIC_TAX=true` for live collection where appropriate.
- The app stores Stripe's reported tax amount, total, and shipping details from the Checkout Session/webhook. The admin dashboard and payment confirmation display subtotal, shipping, tax, and total separately.
- Optional paid-order confirmation emails use Resend. Add `RESEND_API_KEY` and a verified `EMAIL_FROM` sender privately. `ORDER_NOTIFICATION_EMAIL` is an optional BCC for the shop owner.

## Validation notes

The JavaScript source and embedded page scripts should pass syntax checks. A complete server/payment test requires dependencies installed with `npm install`, private local environment values and Stripe test credentials. Do not paste private keys into chat or commit `.env` to source control.


## Separate test deployment

Use `RENDER-IONOS-TEST-SETUP.md` to create a new test Render service separate from the old website. Update `public/js/api-config.js` with the new service URL after Render assigns it. The existing frontend files and visual design are retained. This test package excludes local order database contents and installed dependencies. Do not use ephemeral Render storage for real customer orders or artwork.

## Service-specific order options update

The order builder now switches to a dedicated option profile for each selectable service. Business Cards are locked to the standard 3.5 × 2 inch size; photo print sizes and photo-only controls are limited to photo services; brochure fold choices appear only for brochures; and label/sticker, flyer, menu, invitation, and website/design selections show their own relevant controls. Switching services resets service-specific selections and clears the previous artwork/notes so unrelated values are not carried into the next item. Each cart item stores a snapshot of its own configuration and checkout submits those snapshots independently.

Displayed prices remain estimates. The server independently calculates checkout amounts and custom-quote services cannot be paid until approved.


## Starter pricing note
The print prices in this build are introductory planning prices. The owner has not yet purchased production paper, label media, or packaging. Before accepting paid production orders, test each material on the Epson ET-8550, record actual ink, media, packaging and waste costs, and revise prices if needed. Waterproof performance must be tested on the exact media and finish; do not promise waterproof results based only on a media listing.


### Temporary 6% checkout test (Stripe TEST mode only)

Set `STRIPE_TEST_TAX_RATE=6` only with an `sk_test_...` Stripe key to simulate a 6% tax rate on physical printed-product line items. The app creates/reuses a clearly labelled Stripe tax rate marked `AIO TEST ONLY`. This is not a live tax configuration, not a legal tax determination, and is ignored when a live Stripe key is used. Standalone web design/development services and the separately stated shipping line are excluded from this temporary test simulation. After Virginia Tax confirms the EIN and registration, remove `STRIPE_TEST_TAX_RATE` and configure Stripe Tax registrations/product tax codes before setting `STRIPE_AUTOMATIC_TAX=true`.
