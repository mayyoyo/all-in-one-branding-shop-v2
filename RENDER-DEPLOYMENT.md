# Render deployment

Use [`RENDER-IONOS-TEST-SETUP.md`](./RENDER-IONOS-TEST-SETUP.md) for the full separate staging procedure. Create a **new** private GitHub repository and a **new** Render Web Service; do not redeploy the old live service.

- Build: `npm ci`
- Start: `npm start`
- Health check: `/api/health`
- Node: 22.23.4 (`.node-version`)
- Persistent disk mount: `/var/data`
- `DATA_DIR=/var/data`
- `UPLOAD_DIR=/var/data/uploads`
- Stripe test credentials only during staging.
- `STRIPE_AUTOMATIC_TAX=false`
- `STRIPE_TEST_TAX_RATE=6` for the clearly marked TEST-MODE-ONLY printed-product tax simulation.

Do not accept real orders on ephemeral storage. Do not use the temporary 6% simulation for live charges. Remove it and configure the real Stripe Tax registration/product categories after Virginia Tax confirms the EIN and registration.
