# All-in-One Branding Shop — separate Render + IONOS staging setup

This is a **new staging deployment only**. It must not replace or modify the existing live website, old Render service, or apex/`www` DNS. Correct business domain: `allinonebrandingshop.com` (no hyphens).

## Safety checklist

- Use a new private GitHub repository named `all-in-one-branding-shop-v2`.
- Create a completely new Render Web Service. Do not edit the old service.
- Use Stripe TEST mode only (`sk_test_...`) and a separate test webhook.
- The included temporary 6% test tax works only with a Stripe test key. It is a checkout simulation, not tax advice or live tax collection. Remove `STRIPE_TEST_TAX_RATE` before using live Stripe keys.
- Do not change the apex or `www` DNS records. Use `test.allinonebrandingshop.com` in a separate IONOS webspace directory.
- This ZIP excludes `.env`, local SQLite databases, existing orders and uploaded artwork.

## 1. Create a new GitHub repository

1. Visit https://github.com/new.
2. Name it `all-in-one-branding-shop-v2`; choose **Private**.
3. Do not initialize it with a README, license or .gitignore.
4. Extract this ZIP and open Command Prompt in the extracted project folder (the folder containing `package.json`).
5. Run:

```bat
git init
git add .
git status
```

Check that `.env`, database files and customer artwork are not listed. Then run (replace the URL with the new repository URL GitHub shows):

```bat
git commit -m "Prepare All-in-One Branding Shop staging site"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/all-in-one-branding-shop-v2.git
git push -u origin main
```

If `origin` already exists, stop and inspect `git remote -v` before changing it.

## 2. Create a NEW Render Web Service

1. Visit https://dashboard.render.com/ → **New** → **Web Service**.
2. Connect GitHub and select `all-in-one-branding-shop-v2`.
3. Configure:
   - Runtime: Node
   - Branch: `main`
   - Root Directory: blank
   - Build Command: `npm ci`
   - Start Command: `npm start`
   - Health Check Path: `/api/health`
   - Node version: `.node-version` (22.23.4)
4. Create the service and copy its newly assigned `https://....onrender.com` URL. Do not use the old Render URL.

### Persistent storage

This application stores SQLite orders and artwork files on disk. Render's normal filesystem is ephemeral. Before keeping test orders or uploads, attach a persistent disk to the new service:

- Mount path: `/var/data`
- Set `DATA_DIR=/var/data`
- Set `UPLOAD_DIR=/var/data/uploads`

A persistent disk requires a Render plan that supports disks. Do not accept real customer orders with ephemeral storage. Documentation: https://render.com/docs/disks.

## 3. Configure the NEW Render environment

In the new Render service → **Environment**, add the following, replacing placeholders with your actual new Render URL and private credentials:

```text
NODE_ENV=production
PUBLIC_BASE_URL=https://YOUR-NEW-RENDER-SERVICE.onrender.com
FRONTEND_BASE_URL=https://test.allinonebrandingshop.com
CORS_ORIGINS=https://test.allinonebrandingshop.com
DATA_DIR=/var/data
UPLOAD_DIR=/var/data/uploads
ADMIN_USERNAME=your-private-admin-name
ADMIN_PASSWORD=your-long-unique-password
ADMIN_TOKEN=your-random-64-character-hex-token
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_AUTOMATIC_TAX=false
STRIPE_TEST_TAX_RATE=6
```

Generate an admin token on Windows:

```bat
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never commit or share the values. Add Resend variables only after the sender is verified. Render environment-variable guide: https://render.com/docs/configure-environment-variables.

## 4. Configure a Stripe TEST webhook

1. Open Stripe Dashboard and switch to **Test mode**.
2. Create a webhook endpoint at `https://YOUR-NEW-RENDER-SERVICE.onrender.com/api/stripe-webhook`.
3. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`.
4. Copy the endpoint signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` on the new Render service.
5. Set `STRIPE_SECRET_KEY` to an `sk_test_...` key.
6. Keep `STRIPE_AUTOMATIC_TAX=false` and `STRIPE_TEST_TAX_RATE=6`. On the first physical-print checkout, the app creates or reuses a Stripe test Tax Rate marked `AIO TEST ONLY` and applies it to printed-product lines. The separate shipping line and standalone website service lines are excluded from this temporary simulation.

**Important:** this 6% rate is for test transactions only. Do not use it for real customer payments. Once the EIN is corrected and Virginia Tax confirms registration, remove `STRIPE_TEST_TAX_RATE`, configure the real Stripe Tax registration/product categories, and then enable Automatic Tax as appropriate.

## 5. Create an IONOS test subdomain without touching the live site

1. Sign in to IONOS → **Domains & SSL** → select `allinonebrandingshop.com`.
2. Create the subdomain `test.allinonebrandingshop.com`.
3. Assign it to a **new, separate** webspace directory, for example `/htdocs/aio-staging/`. Do not point it to the existing live website folder.
4. Enable SSL for the test subdomain and wait until HTTPS is active.
5. In IONOS Hosting → **SFTP & SSH**, use the host and username shown in your account. Connect using SFTP, port 22. Do not share the SFTP password.
6. Use FileZilla or WinSCP and upload the **contents** of the project's `public/` directory into the test subdomain's document root. The Node backend remains on Render; do not upload `.env`, `server.js`, the database, or customer uploads to public webspace.

IONOS SFTP guide: https://www.ionos.com/help/hosting/setting-up-and-managing-ftp-access/connection-details-for-ftp/sftp-in-ionos-web-hosting/.

## 6. Connect the IONOS test frontend to the new Render backend

1. On your computer, open `public/js/api-config.js`.
2. Replace `https://REPLACE-WITH-NEW-RENDER-SERVICE.onrender.com` with the exact new Render URL assigned by Render.
3. Save and upload the updated `js/api-config.js` to the matching `js/` folder in the IONOS **staging** directory, overwriting only that staging file.
4. Confirm `FRONTEND_BASE_URL=https://test.allinonebrandingshop.com` and `CORS_ORIGINS=https://test.allinonebrandingshop.com` in Render. Save changes and let Render redeploy.
5. Open `https://YOUR-NEW-RENDER-SERVICE.onrender.com/api/health`. Expect `ok: true` and `stripeConfigured: true`.

## 7. Test the complete flow

1. Open the IONOS test subdomain and verify the homepage, service options, cart and artwork upload.
2. Place a test order for a printed product (for example, a $100 business-card order). At the temporary 6% test rate, Stripe Checkout should show $6.00 test tax on the printed-product line, plus the separate shipping amount if selected.
3. Use Stripe's test card `4242 4242 4242 4242`, any future expiry date and any CVC accepted by Stripe test mode.
4. Confirm webhook delivery succeeds.
5. Confirm the order appears in the admin dashboard with subtotal, shipping, tax and total separated.
6. Verify the payment confirmation and order tracking page.
7. Test a website-service item separately; the temporary printed-product test tax should not be applied to that service line.

## 8. Before any live launch

- Virginia Tax has corrected the EIN and confirmed the correct sales-tax registration.
- Stripe Tax is configured in **live mode** with the applicable registration and product tax categories; no test tax rate remains.
- Live Stripe keys and a separate live webhook are configured privately.
- Persistent order database and artwork storage are working and backed up.
- Email sender is verified and tested.
- Checkout, payment, webhook, admin, tracking, mobile and shipping tests pass.
- Existing live website, data and DNS have backups and a cutover plan.

Only after your approval should the apex and `www` domain destinations be changed. This guide cannot log in to or make account changes inside GitHub, Render, Stripe or IONOS for you.
