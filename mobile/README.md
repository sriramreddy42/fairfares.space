# FairFares Mobile

This is the long-term native mobile app layer for FairFares. It is an Expo / React Native app that talks to the existing Python + SQLite backend instead of duplicating users, housing posts, chats, or communities.

## Run locally

```bash
cd mobile
npm install
EXPO_PUBLIC_FAIRFARES_API_URL=http://127.0.0.1:8000 npm run start:go
```

For a real device on the same Wi-Fi, replace `127.0.0.1` with your Mac's local IP address.

Use `npm run start:go` for Expo Go. Use `npm run start:dev` only after adding `expo-dev-client` and creating a native development build.

## Implemented in this slice

- Dark compact theme inspired by modern ride/share apps.
- Housing landing screen with search, quick actions, CTA, welcome card, listing carousel, room types, and localities.
- Dashboard shell for housing posts, messages, expiry days, rides, and future booking activity.
- Messenger shell with All / Unread / Groups / Communities tabs.
- Login gate before messaging a listing owner.
- Profile and services screens.
- API client using `Authorization: Bearer <token>`.

## Backend endpoints added

- `POST /api/mobile/login`
- `POST /api/mobile/logout`
- `GET /api/mobile/bootstrap`
- `GET /api/mobile/housing`

The mobile endpoints reuse the existing `users`, `sessions`, `accommodation_posts`, `chat_conversations`, and `chat_communities` tables.

## Next mobile milestones

- Persist auth token in secure storage.
- Native image upload for housing posts.
- Full listing details modal.
- Real-time chat refresh or websocket/SSE polling.
- Push notifications for new messages.
- Native Google Maps screen for radius and distance.
