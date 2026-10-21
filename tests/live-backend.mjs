// Disposable integration rooms only. No user rooms are read or modified.
import assert from "node:assert/strict";
const key = "AIzaSyD-HAEX4W4LrF-rLr5ISLIBDWMWJwYtjdA";
const root = "https://socialbuzz-party-2026-default-rtdb.firebaseio.com/";
const users = [];
const rooms = [];
async function guest() {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  const u = await r.json();
  assert.ok(r.ok, u.error?.message);
  users.push(u);
  return u;
}
async function call(path, method, body, user) {
  const r = await fetch(
    `${root}${path}.json${user ? "?auth=" + user.idToken : ""}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
  return { status: r.status, data: await r.json() };
}
const good = (r) => assert.equal(r.status, 200, JSON.stringify(r.data));
const denied = (r) =>
  assert.ok(
    r.status === 401 || r.status === 403,
    `Expected denial, got ${r.status}`,
  );
let passed = 0;
function check(label) {
  passed++;
  console.log("PASS", label);
}
try {
  const host = await guest();
  const guests = [];
  for (let i = 0; i < 7; i++) guests.push(await guest());
  for (const capacity of [4, 6]) {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const code = Array.from(
      crypto.getRandomValues(new Uint8Array(6)),
      (n) => letters[n % letters.length],
    ).join("");
    rooms.push({ code, host });
    const time = Date.now();
    good(
      await call(
        `rooms/${code}`,
        "PUT",
        {
          hostId: host.localId,
          createdAt: time,
          expiresAt: time + 3600000,
          settings: {
            mode: "mix",
            capacity,
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
        },
        host,
      ),
    );
    denied(await call(`rooms/${code}`, "GET", undefined, guests[0]));
    check(`${capacity}-seat room hides membership from outsiders`);
    for (let i = 0; i < capacity; i++) {
      good(
        await call(
          `rooms/${code}/seats/${i}`,
          "PUT",
          guests[i].localId,
          guests[i],
        ),
      );
      good(
        await call(
          `rooms/${code}/players/${guests[i].localId}`,
          "PUT",
          {
            uid: guests[i].localId,
            name: `QA ${i + 1}`,
            avatar: i,
            team: i % 2,
            slot: i,
            joinedAt: time,
            online: true,
          },
          guests[i],
        ),
      );
    }
    check(`${capacity} independent anonymous players can join`);
    denied(
      await call(
        `rooms/${code}/seats/${capacity}`,
        "PUT",
        guests[capacity].localId,
        guests[capacity],
      ),
    );
    denied(
      await call(
        `rooms/${code}/players/${guests[capacity].localId}`,
        "PUT",
        {
          uid: guests[capacity].localId,
          name: "Overflow",
          avatar: 1,
          slot: 0,
          team: 0,
          joinedAt: time,
          online: true,
        },
        guests[capacity],
      ),
    );
    check("room capacity cannot be bypassed by writing a player directly");
    denied(
      await call(
        `rooms/${code}/state/totals/${guests[0].localId}`,
        "PUT",
        999999,
        guests[0],
      ),
    );
    check("players cannot forge scores");
    good(
      await call(
        `rooms/${code}/state`,
        "PUT",
        {
          phase: "question",
          round: 0,
          questionId: "c01",
          startedAt: Date.now() - 1000,
          deadline: Date.now() + 24000,
          revealText: "",
        },
        host,
      ),
    );
    good(
      await call(
        `answers/${code}/0/${guests[0].localId}`,
        "PUT",
        { value: 0, at: { ".sv": "timestamp" } },
        guests[0],
      ),
    );
    check("server-timestamped answer locks");
    denied(
      await call(
        `answers/${code}/0/${guests[0].localId}`,
        "PUT",
        { value: 1, at: { ".sv": "timestamp" } },
        guests[0],
      ),
    );
    check("locked answer cannot be changed");
    denied(
      await call(
        `answers/${code}/0/${guests[0].localId}`,
        "GET",
        undefined,
        guests[1],
      ),
    );
    denied(await call(`answers/${code}/0`, "GET", undefined, guests[1]));
    good(await call(`answers/${code}/0`, "GET", undefined, host));
    check("only the host can see all unrevealed answers");
    denied(
      await call(
        `answers/${code}/0/${guests[1].localId}`,
        "PUT",
        { value: 0, at: Date.now() - 6000 },
        guests[1],
      ),
    );
    check("player cannot forge an earlier timestamp");
    good(
      await call(
        `rooms/${code}/state/deadline`,
        "PUT",
        Date.now() - 1000,
        host,
      ),
    );
    denied(
      await call(
        `answers/${code}/0/${guests[1].localId}`,
        "PUT",
        { value: 0, at: { ".sv": "timestamp" } },
        guests[1],
      ),
    );
    check("answers after the deadline are rejected");
    good(
      await call(
        `rooms/${code}/players/${guests[0].localId}/online`,
        "PUT",
        false,
        guests[0],
      ),
    );
    good(
      await call(
        `rooms/${code}/players/${guests[0].localId}/online`,
        "PUT",
        true,
        guests[0],
      ),
    );
    good(
      await call(
        `answers/${code}/0/${guests[0].localId}`,
        "GET",
        undefined,
        guests[0],
      ),
    );
    check("reconnection preserves a locked answer");
    good(await call(`rooms/${code}/expiresAt`, "PUT", Date.now() - 1000, host));
    denied(await call(`rooms/${code}`, "GET", undefined, guests[0]));
    // Host write access expires too; restore this test room with admin cleanup outside this script.
    rooms[rooms.length - 1].expired = true;
    check("expired room access is denied");
  }
  console.log(`Completed ${passed} live backend checks.`);
} finally {
  for (const { code, host, expired } of rooms) {
    if (!expired) {
      await call(`answers/${code}`, "DELETE", undefined, host);
      await call(`rooms/${code}`, "DELETE", undefined, host);
    } else console.log("Expired disposable room awaiting admin cleanup:", code);
  }
  for (const user of users)
    await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: user.idToken }),
      },
    );
}
