# FairFares

A dependency-free Python + SQLite dynamic website with authentication, session cookies, editable homepage content, and a poster-led landing page.

## Run

```bash
python3 app.py
```

Open `http://127.0.0.1:8000`.

For hosted environments, set:

```bash
HOST=0.0.0.0
PORT=8000
PUBLIC_BASE_URL=https://your-live-site.example
FAIRFARES_DB_PATH=/var/data/fairfares.sqlite3
FAIRFARES_BACKUP_DIR=/var/data/backups
FAIRFARES_BACKUP_KEEP=20
```

`FAIRFARES_DB_PATH` should point to persistent storage in production. If it is left on the app container filesystem, user accounts, bookings, discounts, and admin updates can disappear after redeploys or restarts.

The app creates an automatic SQLite backup on startup unless `FAIRFARES_AUTO_BACKUP=0`. Admins can also create and download backups from the Developer Portal. Backups are stored in `FAIRFARES_BACKUP_DIR`, and the newest `FAIRFARES_BACKUP_KEEP` files are retained.

## Signup Activation

New signups are created as unverified users. The app generates an activation email and stores a local test copy in `data/outbox/`; click the activation link to enable the account and open the booking dashboard.

For real email delivery with Resend, create a `.env` file:

```bash
RESEND_API_KEY=your_new_resend_api_key
RESEND_FROM=FairFares <hello@fairfare.space>
```

If you verify your own domain in Resend, replace `RESEND_FROM` with an address from that domain.

To send real email, provide SMTP settings before starting the app:

```bash
SMTP_HOST=smtp.example.com SMTP_PORT=587 SMTP_USER=user SMTP_PASSWORD=password SMTP_FROM=hello@fairfares.com python3 app.py
```

## Slack Operations Alerts

FairFares can send operations alerts through the Slack bot token. Add the bot to the destination channels, then configure the token and optional channel overrides:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_BOOKINGS=#bookings
SLACK_CHANNEL_PAYMENTS=#payments
SLACK_CHANNEL_PICKUPS=#pickups
SLACK_CHANNEL_RETURNS=#returns
SLACK_CHANNEL_SUPPORT=#customer-support
SLACK_CHANNEL_VEHICLES=#vehicle-maintenance
SLACK_CHANNEL_ADMIN=#admin
SLACK_CHANNEL_AI=#ai-agent
```

Incoming webhooks can remain configured as a fallback, but normal alerts use `chat.postMessage` when `SLACK_BOT_TOKEN` is available:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SLACK_WEBHOOK_BOOKINGS=https://hooks.slack.com/services/...
SLACK_WEBHOOK_SUPPORT=https://hooks.slack.com/services/...
SLACK_WEBHOOK_VEHICLES=https://hooks.slack.com/services/...
SLACK_WEBHOOK_PAYMENTS=https://hooks.slack.com/services/...
SLACK_WEBHOOK_ADMIN=https://hooks.slack.com/services/...
```

If no Slack token or webhook is configured, notifications are not sent but a local audit copy is still written under `data/outbox/slack-*.json`.

When `SLACK_BOT_TOKEN` is configured, new workspace groups also create a matching public Slack channel such as `#ff-airport-pickups`. The app stores the Slack channel ID/name and shows an `Open #channel` action in the workspace group drawer. The Slack app needs bot scopes for channel creation and posting, including `channels:manage`, `channels:write`, and `chat:write`.

## Stripe Checkout

FairFares uses Stripe Checkout for the 10% booking hold on Manage Booking. Configure these environment variables in Render:

```bash
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Create the Stripe webhook endpoint as:

```bash
https://your-render-url/stripe/webhook
```

Subscribe it to `checkout.session.completed`, then copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`. The success redirect also confirms paid sessions, but the webhook is the reliable production path when a customer pays and closes the browser before returning.

## Admin

No administrator is created with a repository-known password. Set both
`FAIRFARES_ADMIN_EMAIL` and a unique `FAIRFARES_ADMIN_PASSWORD` (preferably from
your deployment secret manager) before first startup. Remove the bootstrap
password variable after the account is established so startup cannot rotate it.
Older installations using the former repository default have that password
invalidated automatically; use the verified password-reset flow to regain access.

Use the dashboard to update homepage copy and the poster image path. Drop supplied poster files into `static/posters/` and set `poster_image` to a path like `/static/posters/my-poster.jpg`.

## FairFares Explorer Sprint 1

Explorer is implemented at `/explorer` in the current Python + SQLite app stack. This repository is not currently a Next.js/Prisma codebase, so no Prisma migration is required for this sprint. The app creates the Explorer tables automatically on startup.

Sprint 1 includes:

- Location state with browser detection and manual city fallback.
- FairFares booking check with `+100 XP` bonus messaging.
- Mood tags, preferences, quest generation, mystery stop, stop cards, XP progress, and badge preview.
- Google Places-backed stop names, addresses, ratings, review snippets, and reference photos when `GOOGLE_PLACES_API_KEY` is set.
- Google Maps route preview when `GOOGLE_MAPS_API_KEY` is set. Restrict this browser key to your FairFares domains in Google Cloud.
- API-shaped placeholders:
  - `POST /api/explorer/quests`
  - `GET /api/explorer/quests/{id}`
  - `POST /api/explorer/checkins`
  - `POST /api/explorer/xp`
  - `GET /api/explorer/place-photo?ref=...`

Explorer environment hooks:

```bash
GOOGLE_MAPS_API_KEY=your_google_maps_key
GOOGLE_PLACES_API_KEY=your_google_places_key
OPENAI_API_KEY=your_openai_key
```

`OPENAI_API_KEY` is reserved for a later AI route-writing sprint. The current app uses deterministic quest copy plus Google Places data.

## Mobile App Shell

FairFares can run as native iOS and Android apps through Capacitor. The current mobile shell loads the live hosted website at `https://fairfares.onrender.com`, which keeps the Flask backend, authentication, bookings, Explorer, and admin-driven content in one place.

After changing `capacitor.config.json` or adding Capacitor plugins, sync the native projects:

```bash
npm run cap:sync
```

Open the native projects:

```bash
npm run cap:open:ios
npm run cap:open:android
```

Build and signing still happen in Xcode for iOS and Android Studio for Android. Future native features such as camera capture, location permissions, push notifications, and document handling can be added as Capacitor plugins.

## Deploy

The project includes `render.yaml` for Render hosting.

1. Push this folder to a private GitHub repository.
2. Create a new Render Blueprint from that repository.
3. Set these Render environment variables:
   - `FAIRFARES_DB_PATH=/var/data/fairfares.sqlite3`
   - `FAIRFARES_BACKUP_DIR=/var/data/backups`
   - `FAIRFARES_BACKUP_KEEP=20`
   - `RESEND_API_KEY`
   - `RESEND_FROM=FairFares <hello@fairfare.space>`
   - `PUBLIC_BASE_URL=https://your-render-url`
   - `STRIPE_PUBLISHABLE_KEY`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - Optional Slack webhooks such as `SLACK_WEBHOOK_BOOKINGS`, `SLACK_WEBHOOK_SUPPORT`, `SLACK_WEBHOOK_VEHICLES`, and `SLACK_WEBHOOK_PAYMENTS`
4. Keep the `fairfares-data` disk from `render.yaml` attached to the service.
5. Deploy the web service.

Do not commit `.env`; keep production secrets in the hosting provider's environment variables.

## Deferred TODO

- Create a Google Cloud Storage bucket for private FairFares uploads, then move sensitive app files there instead of normal Google Drive service-account storage. This should cover driver licenses, insurance documents, rental agreements, pickup/return photos, invoices/receipts, ROI files, support attachments, purchase receipts, and maintenance/repair receipts.
