# SocialBuzz release conventions

- Preserve the user's `year.month.day.sequence` version format. The initial release is `2026.10.21.01`.
- For each subsequent logical app release, run `npm run version:bump` once before building. It uses America/Edmonton, increments the sequence on the same day, and starts a new day at `01`. Do not bump for every file edit or test repair within one release.
- `release.json` is the local source version. The header, built version manifest, and service worker must agree.
- GitHub Actions also advances the published version automatically when a new commit is deployed, using the last live `version.json`. Rerunning the same deployed commit keeps its version. CI must stop if it cannot check the previous version, except for the first release's expected 404.
- A newer build must prompt for Refresh. Do not reload an active game automatically or activate an update without the user's Refresh action.
- Keep installation visible on phones. Provide native install prompts when supported and honest browser instructions otherwise.
- Test version rollover, update detection, refresh activation, and offline behavior after changes to the PWA lifecycle.
- Multiplayer starts use readiness barriers and acknowledged countdown digits. Never start a fixed three-second countdown when the host first sends a round; late phones must receive and display every digit before question timing starts.
- Keep active player controls within the visible phone viewport. Verify all four game modes at 360 by 640, including input/submit visibility in a keyboard-sized viewport.
