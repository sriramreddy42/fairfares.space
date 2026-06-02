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
```

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

## Deploy

The project includes `render.yaml` for Render hosting.

1. Push this folder to a private GitHub repository.
2. Create a new Render Blueprint from that repository.
3. Set these Render environment variables:
   - `RESEND_API_KEY`
   - `RESEND_FROM=FairFares <hello@fairfare.space>`
   - `PUBLIC_BASE_URL=https://your-render-url`
4. Deploy the web service.

Do not commit `.env`; keep production secrets in the hosting provider's environment variables.
