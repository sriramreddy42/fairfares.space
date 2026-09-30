# FairFares DiceBear service

This directory deploys the official DiceBear HTTP API as a private Render service.
FairFares uses it only to create character avatars, then stores the selected
avatar data and serves the result through FairFares' existing profile-avatar flow.

The service is intentionally not public. It listens on DiceBear's standard port
`3000`; configure the main FairFares service's `FAIRFARES_DICEBEAR_API_ORIGIN`
to its Render private-network URL after the service is created.

The main application permits only the approved CC0 `lorelei` style. No
member-controlled arbitrary URL is accepted.
