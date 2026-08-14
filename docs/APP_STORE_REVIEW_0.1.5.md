# FairFares iOS 0.1.5 App Review package

This file is an internal release gate. Replace every `REQUIRED:` value with
verified submission information before sending the build to App Review. Never
commit real reviewer passwords to this repository.

## Submission status

- [ ] The submitted build contains the current release commit.
- [ ] The production API and media storage are healthy and will stay available
      throughout review.
- [ ] Two fictional, activated reviewer accounts have been tested from a clean
      installation and will not expire during review.
- [ ] A continuous recording was captured on a physical iPhone running the
      latest public iOS release.
- [ ] The recording and this release's completed review notes were attached in
      App Store Connect.
- [ ] App Store screenshots show real application screens and fictional data.
- [ ] Support, privacy, terms, community-guidelines, and account-deletion URLs
      return successful responses without authentication.

## Physical-device test matrix

Record the exact values rather than simulator names.

| Device | iOS version | Installation | Result | Tester/date |
| --- | --- | --- | --- | --- |
| REQUIRED: current small/standard iPhone | REQUIRED | Clean TestFlight install | REQUIRED | REQUIRED |
| REQUIRED: current large iPhone | REQUIRED | Clean TestFlight install | REQUIRED | REQUIRED |
| REQUIRED: second current iPhone size if available | REQUIRED | Clean TestFlight install | REQUIRED | REQUIRED |

iPad support is disabled for this submission. Re-enable it only after the
iPad layout has been tested on a physical iPad and matching App Store metadata
is ready.

## Required recording

Use a physical device with the latest public iOS release. Start with the app
icon visible and make one continuous recording that shows:

1. Launch and guest browsing.
2. Registration and activation, or an explanation that review uses the supplied
   activated demo account.
3. Login with the primary fictional reviewer account.
4. Housing search and creation of a fictional listing.
5. Carpool browsing/creation and Rental Cars browsing.
6. Chitthi direct messaging with the second fictional account: text, photo, and
   video; long-press a received message and demonstrate Report; open chat
   options and demonstrate Block/Unblock.
7. Chitthi group messaging and group information.
8. Camera, photo-library, contacts, notification, and location prompts at the
   user action that requires each permission. Explain the manual fallback when
   a permission is declined.
9. Rental checkout far enough to demonstrate that payment is for a real-world
   rental service. Do not use a real customer or payment card.
10. Account > Terms, Community Guidelines, Privacy Policy, Report an issue, and
    Delete account. Show the deletion confirmation but do not delete the demo
    account.
11. Logout and login again, followed by opening an existing encrypted chat.

Use only fictional accounts and content in the recording.

## App Review credentials

Enter the primary account in App Store Connect's Username and Password fields.
Put the second account in Notes. Do not place either password in this file.

- Primary account: `REQUIRED: enter directly in App Store Connect`
- Secondary messaging account: `REQUIRED: enter directly in App Store Connect`
- Two-factor authentication: `None`, or provide complete reviewer instructions
- Account activation: both accounts must already be activated

## Notes for Review

The final text must remain within App Store Connect's 4,000-byte Notes limit.
Replace every `REQUIRED:` field.

```text
FairFares is a relocation and local-mobility app for students, new residents,
travelers, and local communities in the United States.

CORE FUNCTIONS
Users can search or publish housing and roommate listings; create and respond
to carpool requests; browse and reserve real-world rental cars; and use Chitthi
for end-to-end encrypted direct and group messaging. Chitthi supports
user-selected photos, videos, files, contacts, and location. Users can report
messages, block users, contact support, and request account deletion in-app.

TARGET AUDIENCE AND VALUE
FairFares brings housing, roommates, rides, rental cars, and local community
communication into one service for people moving to or traveling within the
United States.

REVIEW ACCESS
The primary credentials are in the App Review Information sign-in fields.
Second fictional account for messaging/reporting/blocking:
Username: REQUIRED: SECOND ACCOUNT EMAIL
Password: REQUIRED: SECOND ACCOUNT PASSWORD
Both accounts are activated, contain fictional data, require no SMS/2FA, and
will remain available throughout review.

REVIEW FLOW
1. Browse Home while signed out, then sign in with the primary demo account.
2. Housing: browse listings and open the create-post flow.
3. Carpool and Rental Cars: browse their main flows.
4. Chitthi: open the conversation with REQUIRED: SECOND DEMO NAME. Send text
and user-selected media. Long-press a received message for Report. Open the
chat menu for Block/Unblock. Open a group to review group messaging.
5. Account: Privacy Policy, Terms, Community Guidelines, support reporting,
logout, and Delete account are available here. Delete account initiates a
verified deletion request and shows its tracking deadline.

PAYMENTS
Stripe checkout is exclusively for real-world rental-car services and related
security-deposit authorization. FairFares does not sell digital content,
virtual currency, or subscriptions.

PERMISSIONS
Photos/videos: select media the user chooses to send in Chitthi or use as an
account/group image. Camera: capture a chosen Chitthi photo. Location: set ride
pickup, find nearby drivers, estimate distance, or explicitly share location in
Chitthi. Contacts: privately match discoverable Chitthi contacts or select a
contact to share; the address book is not uploaded. Notifications: message and
service updates. Permission prompts occur only when the related feature is used.

EXTERNAL SERVICES
FairFares production API/database; Cloudflare R2 encrypted media storage;
Stripe for real-world rental checkout/deposit authorization; Apple and Google
authentication; Expo push notification delivery; and Apple/Google map and
location services. REQUIRED: ADD OR REMOVE SERVICES TO MATCH PRODUCTION.

REGIONS
The app functions consistently wherever it is offered. Listings, rides, rental
inventory, prices, and availability vary by location/provider. Current service
focus is the United States.

REGULATORY/RIGHTS
FairFares is not a medical, banking, insurance, or regulated financial-services
app. Rental transactions concern real-world services. Branding and supplied
media are owned/licensed; reviewer content and accounts are fictional.

TESTED DEVICES
REQUIRED: DEVICE MODEL — iOS VERSION
REQUIRED: DEVICE MODEL — iOS VERSION
REQUIRED: SECOND IPHONE MODEL — iOS VERSION, or state not available

A physical-device recording of the requested flows is attached.
```

## App-side evidence in this version

- Signup/login and consent links: `mobile/App.tsx`
- Purpose strings and platform permissions: `mobile/app.json`
- In-app account deletion and support reporting: `mobile/src/screens/ProfileScreen.tsx`
- Message reporting and direct-user blocking: `mobile/src/screens/MessengerScreen.tsx`
- Moderation, blocking, and deletion APIs: `app.py`
- Public policy pages: `templates/privacy.html`, `templates/terms.html`,
  `templates/community_guidelines.html`, and `templates/account_deletion.html`

## Final operational checks

- Verify `https://www.fairfare.space/privacy`.
- Verify `https://www.fairfare.space/terms`.
- Verify `https://www.fairfare.space/community-guidelines`.
- Verify `https://www.fairfare.space/account-deletion`.
- Verify the App Store Support URL and review contact email/phone.
- Verify review accounts after a clean installation and on cellular data.
- Verify the backend does not cold-start, return 5xx errors, or require a local
  development server during review.
- Keep the reviewer accounts and all production dependencies live until review
  is complete.
