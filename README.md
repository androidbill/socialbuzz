# SocialBuzz

**Good company. Great competition.** A premium party-game PWA with a shared host display and phone controllers.

Play at **https://androidbill.github.io/socialbuzz/**.

## Play

1. Open SocialBuzz on a laptop connected to the TV (or a supported TV browser).
2. Choose **Host a party**. Select a four- or six-seat room, individual or balanced team play, a mode, and a pace.
3. Guests scan the QR code or enter the six-letter room code on their phones. The host can join on a phone too.
4. Start with at least two players. Keep the host screen open; it coordinates reveals and round changes.

An internet connection is required for multiplayer. Solo practice works offline after the app has been loaded and cached. Installation is optional; availability depends on the browser.

## Phone synchronization and performance

Each multiplayer round first waits for the host and every joined player to confirm their screen is ready. Firebase then coordinates **3, 2, and 1 as separate acknowledged steps**. A phone acknowledges a number only after displaying it in the foreground for a full second. The host cannot advance past a number while another phone is still loading or displaying it. A unique round token prevents acknowledgements from an earlier round counting toward the next. Question timing starts only after all screens have completed the countdown, with a shared future start and delivery allowance based on acknowledgement spread. Slow or backgrounded phones hold the group rather than silently skipping digits. Host controls can remove an absent player. All screens must use the updated app; an older app cannot acknowledge this protocol.

The active player screen uses a compact question card, latest trivia clue, a two-by-two choice grid, and an adaptive answer area inside the visible phone viewport. Prediction and text-entry controls use the same layout. Browser bars, safe areas, orientation changes, and visual-viewport changes resize the play area. Full standings remain on the host screen; player round results and personal points remain visible on the phone.

Firebase stores each round’s absolute `startedAt` and `deadline`. Every phone derives its countdown and clue timing from those shared timestamps, using Firebase’s server clock offset. Display ticks never subtract time from a private countdown, so a paused browser catches up rather than drifting. Answer timestamps and deadline checks are enforced by Firebase. Scores use the server’s accepted submissions, including answers the host’s listener has not displayed yet.

Only the question display, answer controls, and host round controller redraw with the clock. The home screen, lobby, app header, forms, and standings no longer redraw ten times per second. Hidden pages stop display ticks and catch up immediately on visibility, focus, or page restoration.

After a phone returns from the background or reconnects, SocialBuzz replaces the suspended database connection and verifies the room with an authenticated network-only read before enabling answers or host actions. Live snapshots continue normally; an older verification response cannot overwrite a newer live snapshot. A pending answer says “Locking your answer…” until Firebase acknowledges it. App-shell navigation revalidates its HTTP cache, version checks bypass caches, and the service worker does not intercept Firebase traffic. Network timeouts use AbortController for compatibility with older Safari versions.

These safeguards are not a guarantee of zero latency or identical screen updates: Firebase’s server clock offset is an estimate, network delivery varies, and iOS can suspend a locked/backgrounded app. The host must stay open. Release checks cover clock catch-up, resumption, stale-response ordering, server-confirmed scoring, offline behavior, and update handling. Physical testing on a mix of iPhones and Android phones is still required before claiming device-level performance; this workspace does not provide those devices.

## Installation and updates

Choose **Install app** at the top on desktop or phone. Supported browsers show their native install dialog. Other browsers show platform instructions and a link to open in a regular browser. The install action is hidden when SocialBuzz is already running as an installed app.

The header displays the release in `year.month.day.sequence` form, starting at **2026.10.21.01**. The date uses **America/Edmonton**. A new release on the same day increments the final number; a new day starts at `01`. The version badge also checks for updates when tapped.

The app checks uncached `version.json` on opening, returning to the foreground, and reconnecting. During a game it also checks every 30 seconds and whenever a question starts or its results appear. Outside games it checks every five minutes. Automatic checks pause while the app is hidden or offline. A newer release shows a **Refresh** prompt. The service worker downloads the update in the background and activates it only after Refresh is chosen. Refresh preserves the room URL and saved guest identity; locked answers remain in Firebase. An offline or failed update leaves the current app running and offers a retry.

For a subsequent logical release, run `npm run version:bump` once. It checks the live version to avoid reusing an older counter and updates `release.json`. GitHub Actions provides an additional automatic increment if the source bump was missed, so every new deployed commit receives a newer version. Redeploying the same published commit keeps its version. Local test builds do not consume published version numbers.

The build emits one matching version in the app, `version.json`, and `sw.js`. Release metadata always uses the network and is never served from the offline cache.

## Games included

- **Clue Chase**: four choices, three timed clues, decreasing points, and one irrevocable answer. Correct answers earn 250–1,000 points plus a 100-point speed bonus for the earliest correct response (shared within a 200 ms window).
- **Read the Room**: submit an opinion and predict the room’s majority. Correct predictions earn 600 points; other submissions earn 100. Tied majorities both count.
- **Crowd Says**: three guesses against a curated answer board, 250 points per distinct match. These are editorial boards, **not survey data or popularity rankings**.
- **List Blitz**: up to five guesses, 150 points per canonical match and 100 more for each answer no other player found.
- **Party Mix**: rotates all four modes in a nine-round classic game. Six-round games include trivia, predictions, and a board; twelve-round games extend the mix.

The initial pack contains 58 prompts: 30 trivia questions, 12 opinion questions, eight curated boards, and eight list questions. Short packs are capped to avoid repeats within a game. Each rematch gets a fresh shuffle seed, and answer positions are shuffled consistently across the host and controllers. Facts are stable general knowledge; the starter pack still benefits from broader editorial and party playtesting.

## Development

```sh
npm ci
npm run dev
npm test
npm run build
```

`npm run test:countdown` runs opt-in live checks with two and three players, including a delayed phone, stale/forged acknowledgement rejection, and equal question timestamps. It creates and removes only disposable test rooms and users. Update database rules before running it against the configured project.

Firebase project: `socialbuzz-party-2026`. Database: `socialbuzz-party-2026-default-rtdb` in `us-central1`. Guest identities use Firebase Anonymous Authentication.

Public web configuration is in `src/firebase-config.ts`. It is not an administrator credential. Private access tokens, service accounts, and Firebase CLI credentials must never be committed. Firebase rules are in `database.rules.json` and are deployed independently:

```sh
npx firebase-tools deploy --only database,auth --project socialbuzz-party-2026
```

`node tests/live-backend.mjs` runs an explicitly opt-in integration suite against disposable rooms in the configured Firebase project. It creates temporary anonymous users, exercises the access rules, and removes those users. The expiry checks leave two inaccessible test rooms; delete those room and answer paths through the Firebase console afterward. Never point this suite at another project without reviewing its configuration.

## Trust and room lifecycle

- Only the host identity can change room state or scores. This is a trusted-host party design, not a prize-tournament authority model.
- Private submissions are stored separately from public room state. Players can read their own answers; the host can read the room’s submissions. Other players cannot read them before reveal.
- Database rules enforce one locked submission per player per round, server timestamps, deadlines, membership, and fixed seat limits.
- Server clock offsets synchronize the host and phone countdowns. The earliest-answer bonus is deliberately small.
- Rooms become inaccessible after six hours. Expiry is access control, not automatic data deletion. RTDB records require periodic owner cleanup. Ending a room marks it closed; the record remains until cleanup.
- Reopening the same tab restores the session. Guest identity is remembered in that browser. Clearing browser storage loses that guest’s identity. A returning host must use the original browser identity.
- Team games require equal team sizes at start; teams sum individual points. There are no player eliminations.
- The game collects guest nicknames, avatars, room settings, timestamps, answers, and scores. No advertising or analytics SDK is installed.

## Delivery

Pushes to `main` run unit tests, build the static app, and deploy to GitHub Pages through `.github/workflows/pages.yml`. Relative assets, QR invite links, the manifest, and the service worker support the `/socialbuzz/` project path. Database rules do not auto-deploy from GitHub; use the authenticated Firebase CLI command above when they change.

## Next expansion

Real survey packs and classic team steals; picture-reveal rounds; more questions and accepted aliases; host adjudication for disputed free-text answers; custom party packs; narration and more accessibility testing; and a capped final-round wager. These are planned extensions, not features claimed in this first release.
