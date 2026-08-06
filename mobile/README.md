# FairFares Mobile

This is the long-term native mobile app layer for FairFares. It is an Expo / React Native app that talks to the existing Python + SQLite backend instead of duplicating users, housing posts, chats, or communities.

## Run locally

```bash
cd /Users/sriramreddybandari/Desktop/FairFares
HOST=0.0.0.0 PORT=8010 python3 app.py
```

In another terminal:

```bash
cd mobile
npm install
npm run start:go
```

For a real device on the same Wi-Fi, the app derives your Mac's local IP from Expo and calls the backend on port `8010`. If needed, override it with `EXPO_PUBLIC_FAIRFARES_API_URL=http://YOUR_MAC_IP:8010 npm run start:go`.

Use `npm run start:go` for Expo Go. Use `npm run start:dev` only after adding `expo-dev-client` and creating a native development build.

## Social sign-in configuration

Google and Apple sign-in both finish with SMS verification of the user's phone
number. Password login remains available. Configure these public OAuth client IDs
in the EAS build environment (never put an OAuth client secret in the app):

```text
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...
```

The backend must allow the same Google client IDs and have Twilio Verify
credentials. See the repository `.env.example` for the Render variable names.
Apple sign-in uses the `com.fairfares.mobile` bundle identifier.

Changing OAuth configuration, enabling Apple sign-in, or adding these native
modules requires a new iOS and Android build; an over-the-air JavaScript update
is not sufficient.

## Implemented in this slice

- Dark compact theme inspired by modern ride/share apps.
- Housing landing screen with search, quick actions, CTA, welcome card, listing carousel, room types, and localities.
- Dashboard shell for housing posts, messages, expiry days, rides, and future booking activity.
- Chitthi messaging with direct chats, groups, communities, encrypted messages,
  media, contact discovery, and offline queuing.
- Login gate before messaging a listing owner.
- Profile and services screens.
- API client using `Authorization: Bearer <token>`.
- Password login plus Google and Apple sign-in with required phone verification.

## Backend endpoints added

- `POST /api/mobile/login`
- `POST /api/mobile/auth/oauth`
- `POST /api/mobile/auth/phone/send`
- `POST /api/mobile/auth/phone/verify`
- `POST /api/mobile/logout`
- `GET /api/mobile/bootstrap`
- `GET /api/mobile/housing`

The mobile endpoints reuse the existing `users`, `sessions`, `accommodation_posts`, `chat_conversations`, and `chat_communities` tables.

Authentication tokens are persisted in native secure storage. A social provider
token never becomes a FairFares session until its signature and claims are
validated by the backend and the phone verification requirement is satisfied.
