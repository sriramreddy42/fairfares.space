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

## Admin

- Email: `admin@fairfares.com`
- Password: `ChangeMe123!`

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
4. Keep the `fairfares-data` disk from `render.yaml` attached to the service.
5. Deploy the web service.

Do not commit `.env`; keep production secrets in the hosting provider's environment variables.
