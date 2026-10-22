// Opt-in integration check: creates and deletes only its own disposable rooms/users.
import assert from "node:assert/strict";
import {
  preparationState,
  nextSynchronizedState,
  syncStep,
} from "../src/round-sync.ts";
const root = "https://socialbuzz-party-2026-default-rtdb.firebaseio.com/";
const key = "AIzaSyD-HAEX4W4LrF-rLr5ISLIBDWMWJwYtjdA";
const users = [],
  rooms = [];
async function guest() {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  const user = await response.json();
  assert.ok(response.ok, user.error?.message);
  users.push(user);
  return user;
}
async function request(path, method, user, body) {
  const response = await fetch(`${root}${path}.json?auth=${user.idToken}`, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
const good = (response) => {
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
};
const denied = (response) => assert.ok([401, 403].includes(response.status));
let checks = 0;
const pass = (message) => {
  checks++;
  console.log("PASS", message);
};
try {
  const host = await guest(),
    phones = [await guest(), await guest(), await guest()];
  for (const count of [2, 3]) {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const code = [...crypto.getRandomValues(new Uint8Array(6))]
      .map((n) => letters[n % letters.length])
      .join("");
    rooms.push({ code, host });
    const room = {
      hostId: host.localId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000,
      settings: {
        mode: "clue",
        capacity: 4,
        teams: false,
        rounds: 6,
        seconds: 24,
        category: "All categories",
      },
      state: {
        phase: "lobby",
        round: -1,
        questionId: "",
        startedAt: 0,
        deadline: 0,
        revealText: "",
      },
    };
    good(await request(`rooms/${code}`, "PUT", host, room));
    for (let i = 0; i < count; i++) {
      const phone = phones[i];
      good(
        await request(`rooms/${code}/seats/${i}`, "PUT", phone, phone.localId),
      );
      good(
        await request(`rooms/${code}/players/${phone.localId}`, "PUT", phone, {
          uid: phone.localId,
          name: `Test ${i + 1}`,
          avatar: i,
          slot: i,
          team: i % 2,
          joinedAt: Date.now(),
          online: true,
        }),
      );
    }
    const state = preparationState(
      { ...room, state: { ...room.state, totals: {} } },
      "c01",
      0,
      crypto.randomUUID(),
    );
    good(await request(`rooms/${code}/state`, "PUT", host, state));
    const current = async () =>
      good(await request(`rooms/${code}`, "GET", host));
    const acknowledge = async (user, participant, token, step) =>
      request(`rooms/${code}/roundReady/${participant}`, "PUT", user, {
        token,
        step,
        at: { ".sv": "timestamp" },
        version: "2026.10.21.04",
      });
    denied(await acknowledge(phones[0], "host", state.syncToken, 0));
    denied(await acknowledge(phones[0], phones[1].localId, state.syncToken, 0));
    denied(await acknowledge(phones[0], phones[0].localId, "wrong-token", 0));
    pass(
      `${count} players: host, other-player, and stale-round acknowledgements are protected`,
    );
    good(await acknowledge(host, "host", state.syncToken, 0));
    for (let i = 0; i < count - 1; i++)
      good(await acknowledge(phones[i], phones[i].localId, state.syncToken, 0));
    assert.equal(nextSynchronizedState(await current(), Date.now(), 24), null);
    pass(`${count} players: preparation waits for the last phone`);
    good(
      await acknowledge(
        phones[count - 1],
        phones[count - 1].localId,
        state.syncToken,
        0,
      ),
    );
    let next = nextSynchronizedState(await current(), Date.now(), 24);
    good(await request(`rooms/${code}/state`, "PUT", host, next));
    for (const digit of [3, 2, 1]) {
      const live = await current();
      assert.equal(live.state.countdownDigit, digit);
      denied(
        await acknowledge(
          phones[0],
          phones[0].localId,
          state.syncToken,
          digit === 3 ? 1 : 0,
        ),
      );
      denied(
        await request(
          `answers/${code}/0/${phones[0].localId}`,
          "PUT",
          phones[0],
          { value: 0, at: { ".sv": "timestamp" } },
        ),
      );
      good(await acknowledge(host, "host", state.syncToken, digit));
      for (let i = 0; i < count - 1; i++)
        good(
          await acknowledge(
            phones[i],
            phones[i].localId,
            state.syncToken,
            digit,
          ),
        );
      assert.equal(
        nextSynchronizedState(await current(), Date.now(), 24),
        null,
      );
      // A deliberately late screen must not miss this digit or lose question time.
      if (count === 2 && digit === 3)
        await new Promise((resolve) => setTimeout(resolve, 2200));
      good(
        await acknowledge(
          phones[count - 1],
          phones[count - 1].localId,
          state.syncToken,
          digit,
        ),
      );
      next = nextSynchronizedState(await current(), Date.now(), 24);
      good(await request(`rooms/${code}/state`, "PUT", host, next));
      pass(
        `${count} players: ${digit} waits for every phone; early answers and skipped digits are rejected`,
      );
    }
    assert.equal(next.phase, "question");
    assert.equal(next.deadline - next.startedAt, 24000);
    const snapshots = await Promise.all(
      phones
        .slice(0, count)
        .map((phone) => request(`rooms/${code}/state`, "GET", phone)),
    );
    for (const snapshot of snapshots)
      assert.deepEqual(
        good(snapshot),
        good(await request(`rooms/${code}/state`, "GET", host)),
      );
    pass(
      `${count} players: every client receives the same future question start and deadline`,
    );
  }
  console.log(`Completed ${checks} live countdown checks.`);
} finally {
  for (const { code, host } of rooms) {
    good(await request(`answers/${code}`, "DELETE", host));
    good(await request(`rooms/${code}`, "DELETE", host));
  }
  for (const user of users) {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: user.idToken }),
      },
    );
    assert.ok(response.ok, "Could not clean up disposable test identity");
  }
}
