# SocialBuzz

**Good company. Great competition.** A premium party-game PWA with a shared host display and phone controllers.

Play at **https://androidbill.github.io/socialbuzz/**.

## Play

1. Open SocialBuzz on a laptop connected to the TV (or a supported TV browser).
2. Choose **Host a party**. Select a four- or six-seat room, individual or balanced team play, a mode, and a pace.
3. Guests scan the QR code or enter the six-letter room code on their phones. The host can join on a phone too.
4. Start with at least two players. Keep the host screen open; it runs the clock and reveals.

An internet connection is required for multiplayer. Solo practice works offline after the app has been loaded and cached. Installation is optional; availability depends on the browser.

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
