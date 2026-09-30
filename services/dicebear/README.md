# FairFares DiceBear service

This directory deploys the official DiceBear HTTP API as a private Render service.
FairFares uses it only to create character avatars, then stores the selected
avatar data and serves the result through FairFares' existing profile-avatar flow.

The service is intentionally not public. It listens on DiceBear's standard port
`3000`. The Render Blueprint injects its private host and port into the main
FairFares service as `FAIRFARES_DICEBEAR_API_ORIGIN`; no dashboard copy/paste
or public URL is required.

The main application permits only the approved CC0 `open-peeps` style. No
member-controlled arbitrary URL is accepted.
