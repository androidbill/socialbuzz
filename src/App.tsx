import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Crown,
  Download,
  ExternalLink,
  HelpCircle,
  Home,
  LayoutGrid,
  List,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import QRCode from "qrcode";
import { BY_ID, MODE_META, QUESTIONS } from "./questions";
import {
  availablePoints,
  shuffleQuestion,
  questionState,
  scoreRound,
  teamTotals,
} from "./engine";
import * as api from "./firebase";
import { onValue, ref } from "firebase/database";
import { APP_VERSION, usePwa } from "./usePwa";
import {
  DEFAULT_SETTINGS,
  type Answer,
  type Category,
  type GameState,
  type Mode,
  type Player,
  type Question,
  type Room,
  type Session,
  type Settings,
} from "./types";

const AVATARS = ["🦊", "🐼", "🦁", "🐸", "🐙", "🐨", "🦄", "🐯"];
const CATEGORIES: Category[] = [
  "All categories",
  "Everyday",
  "World",
  "Science",
  "Entertainment",
  "Sports",
];
const LETTERS = ["A", "B", "C", "D"];
const readSaved = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private browsers may restrict storage. */
  }
};
const readSession = (): Session | null => {
  try {
    return JSON.parse(sessionStorage.getItem("socialbuzz.session") || "null");
  } catch {
    return null;
  }
};
const joinUrl = (code: string) => {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  return url.href;
};
function ModeIcon({ mode, size = 24 }: { mode: Mode; size?: number }) {
  const Icon = {
    mix: Sparkles,
    clue: Zap,
    poll: Users,
    board: LayoutGrid,
    list: List,
  }[mode];
  return <Icon size={size} strokeWidth={1.8} />;
}
function Avatar({ index, small = false }: { index: number; small?: boolean }) {
  return (
    <span
      className={`avatar avatar-${index} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {AVATARS[index] || AVATARS[0]}
    </span>
  );
}
function Modal({
  children,
  title,
  close,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  close: () => void;
  wide?: boolean;
}) {
  const target = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = target.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={target}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <span className="eyebrow">SOCIALBUZZ</span>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
function useTick() {
  const [tick, setTick] = useState(api.now());
  useEffect(() => {
    const id = setInterval(() => setTick(api.now()), 100);
    return () => clearInterval(id);
  }, []);
  return tick;
}
function tone(success: boolean, muted: boolean) {
  if (muted) return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(success ? 660 : 220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      success ? 880 : 160,
      ctx.currentTime + 0.16,
    );
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => void ctx.close();
  } catch {
    /* Audio is optional. */
  }
}

export default function App() {
  const initialCode =
    new URLSearchParams(location.search)
      .get("room")
      ?.toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 6) || "";
  const initialHost =
    new URLSearchParams(location.search)
      .get("host")
      ?.toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 6) || "";
  const savedSession = readSession();
  const shouldJoin = !!initialCode && savedSession?.code !== initialCode;
  const [session, setSession] = useState<Session | null>(() =>
    initialHost.length === 6
      ? { code: initialHost, role: "host" }
      : shouldJoin
        ? null
        : savedSession,
  );
  const [modal, setModal] = useState<
    "host" | "join" | "help" | "practice" | "leave" | "install" | null
  >(shouldJoin ? "join" : null);
  const [settings, setSettings] = useState<Settings>(() =>
    readSaved("socialbuzz.settings", DEFAULT_SETTINGS),
  );
  const [room, setRoom] = useState<Room | null>(null);
  const pwa = usePwa(
    session &&
      room &&
      (room.state.phase === "question" || room.state.phase === "reveal")
      ? `${session.code}:${room.state.round}:${room.state.phase}`
      : null,
  );
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [muted, setMuted] = useState(() =>
    readSaved("socialbuzz.muted", false),
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [connected, setConnected] = useState(false);
  const [auto, setAuto] = useState(true);
  const advanceLock = useRef(false);
  const time = useTick();
  const host = session?.role === "host" && room?.hostId === uid;
  const players = Object.values(room?.players || {}).sort(
    (a, b) => a.joinedAt - b.joinedAt,
  );
  const rawQuestion = room ? BY_ID[room.state.questionId] : undefined;
  const question =
    rawQuestion && room && session
      ? shuffleQuestion(rawQuestion, room.deckSeed || session.code)
      : undefined;

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  useEffect(() => {
    if (session)
      api
        .identity()
        .then(setUid)
        .catch((e) => setError(api.friendlyError(e)));
  }, [session]);
  useEffect(
    () =>
      onValue(ref(api.db, ".info/connected"), (snap) =>
        setConnected(!!snap.val()),
      ),
    [],
  );
  useEffect(() => {
    if (!session || !uid) return;
    setError("");
    return api.watchRoom(
      session.code,
      (next) => {
        setRoom(next);
        if (!next)
          setError("This room has ended. Start a new party to play again.");
      },
      () =>
        setError(
          "This room has ended, expired, or your player was removed. Return home to join a new party.",
        ),
    );
  }, [session, uid]);
  useEffect(() => {
    setAnswers({});
    if (!session || !uid || !room || room.state.round < 0) return;
    return api.watchAnswers(
      session.code,
      room.state.round,
      uid,
      !!host,
      setAnswers,
    );
  }, [session?.code, uid, host, room?.state.round]);
  useEffect(() => {
    if (session && uid && room?.players?.[uid])
      return api.presence(session.code, uid);
  }, [session?.code, uid, !!room?.players?.[uid]]);
  useEffect(() => {
    try {
      sessionStorage.setItem("socialbuzz.session", JSON.stringify(session));
    } catch {
      /* Room code still works without storage. */
    }
  }, [session]);
  useEffect(() => {
    save("socialbuzz.muted", muted);
  }, [muted]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (
      !host ||
      !session ||
      !room ||
      room.state.phase !== "question" ||
      advanceLock.current ||
      !connected
    )
      return;
    const allLocked =
      players.length > 0 && players.every((p) => !!answers[p.uid]);
    if (
      time < room.state.deadline &&
      !(allLocked && time >= room.state.startedAt)
    )
      return;
    advanceLock.current = true;
    api
      .revealRound(session.code, {
        ...room,
        submissions: { [room.state.round]: answers },
      })
      .catch((e) => setError(api.friendlyError(e)))
      .finally(() => {
        advanceLock.current = false;
      });
  }, [time, host, room, answers, connected]);
  useEffect(() => {
    if (!host || !auto || !session || room?.state.phase !== "reveal") return;
    const id = setTimeout(
      () => void action(() => api.nextRound(session.code, room)),
      10000,
    );
    return () => clearTimeout(id);
  }, [host, auto, session?.code, room?.state.phase, room?.state.round]);

  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(api.friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  function openHost(mode: Mode = "mix") {
    setSettings((current) => ({ ...current, mode }));
    setError("");
    setModal("host");
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Invite link copied. Send it to your people.");
    } catch {
      setToast("Your invite link: " + text);
    }
  }
  function goHome() {
    setSession(null);
    setRoom(null);
    setModal(null);
    setError("");
    history.replaceState(null, "", location.pathname);
  }
  async function exitRoom() {
    if (session) {
      if (host) await api.closeRoom(session.code);
      else await api.leaveRoom(session.code).catch(() => {});
    }
    goHome();
  }
  function fullScreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .catch(() => setToast("Fullscreen isn’t available in this browser."));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <button
            className="brand"
            aria-label="SocialBuzz home"
            onClick={() => (session ? setModal("leave") : goHome())}
          >
            <span className="brand-mark">
              <Zap size={24} fill="currentColor" />
            </span>
            <span>
              Social<span className="brand-light">Buzz</span>
              <span className="brand-dot">.</span>
            </span>
          </button>
          <button
            className="version-badge"
            aria-label={`Version ${APP_VERSION}. Check for updates`}
            title="Check for updates"
            onClick={async () => {
              const checked = await pwa.checkForUpdates();
              if (!checked)
                setToast(
                  "Couldn’t check for updates. Try again when you’re online.",
                );
              else if (!checked.updateAvailable)
                setToast("SocialBuzz is up to date.");
            }}
          >
            <span>VERSION</span>
            {APP_VERSION}
          </button>
        </div>
        <nav aria-label="Main navigation">
          {!pwa.installed && (
            <button
              className="nav-link install-action"
              aria-label="Install app"
              onClick={async () => {
                if ((await pwa.install()) === "unavailable")
                  setModal("install");
              }}
            >
              <Download size={16} />
              <span>Install app</span>
            </button>
          )}
          {!session && (
            <a href="#games" className="nav-link">
              The games
            </a>
          )}
          <button
            className="nav-link"
            aria-label="How to play"
            onClick={() => setModal("help")}
          >
            <HelpCircle size={16} />
            <span>How to play</span>
          </button>
          <span className="nav-divider" />
          <button
            className="icon-button"
            aria-label={muted ? "Turn sound on" : "Mute sound"}
            aria-pressed={!muted}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
          </button>
          {session && (
            <button
              className="icon-button"
              aria-label="Toggle fullscreen"
              onClick={fullScreen}
            >
              <Maximize2 size={18} />
            </button>
          )}
        </nav>
      </header>
      {pwa.latest && (
        <section
          className="update-banner"
          role="status"
          aria-label="App update available"
        >
          <span className="update-mark">
            <Download size={20} />
          </span>
          <div>
            <strong>A fresh SocialBuzz is ready.</strong>
            <p>
              Version {pwa.latest.version} is available.{" "}
              {session
                ? "Refresh between rounds; your room and locked answers are saved."
                : "Refresh to get the latest improvements."}
            </p>
            {pwa.updateError && (
              <p className="update-error" role="alert">
                {pwa.updateError}
              </p>
            )}
          </div>
          <button
            className="button primary"
            disabled={pwa.refreshing}
            onClick={() => void pwa.refresh()}
          >
            {pwa.refreshing ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RotateCcw size={16} />
            )}
            {pwa.refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </section>
      )}
      {!online && (
        <div className="connection-banner" role="status">
          <WifiOff size={16} /> You’re offline. Solo practice is available; live
          rooms need an internet connection.
        </div>
      )}
      {session && online && !connected && (
        <div className="connection-banner" role="status">
          <LoaderCircle size={16} className="spin" /> Reconnecting to your room…
          your locked answer is saved.
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="text-button"
            onClick={session ? goHome : () => setError("")}
          >
            {session ? "Return home" : "Dismiss"}
          </button>
        </div>
      )}

      {!session ? (
        <main className="home-main">
          <section className="hero">
            <div className="hero-copy">
              <div className="pill">
                <span className="live-dot" /> YOUR LIVING ROOM. LIVE.
              </div>
              <h1>
                Good company.
                <br />
                <span>Great competition.</span>
              </h1>
              <p className="hero-description">
                Your people. Your phones. Your very own game show.
                <br className="desktop-break" /> Make tonight a little more
                competitive.
              </p>
              <div className="hero-actions">
                <button className="button primary" onClick={() => openHost()}>
                  <Play size={17} fill="currentColor" /> Host a party{" "}
                  <ArrowRight size={18} />
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setError("");
                    setModal("join");
                  }}
                >
                  <Smartphone size={18} /> Join a room
                </button>
              </div>
              <div className="hero-details">
                <span>
                  <Users size={15} /> 4–6 players
                </span>
                <span>
                  <Clock3 size={15} /> 10–20 minutes
                </span>
                <span>
                  <CheckCircle2 size={15} /> No sign-up
                </span>
              </div>
            </div>
            <div className="hero-stage">
              <div className="floating-label">
                <Radio size={14} /> GAME NIGHT, UPGRADED
              </div>
              <div className="preview-card">
                <div className="preview-header">
                  <span className="mini-mode">
                    <Zap size={15} /> CLUE CHASE
                  </span>
                  <span className="point-preview">
                    1,000 <small>PTS</small>
                  </span>
                </div>
                <div className="preview-track">
                  <span />
                </div>
                <p className="preview-category">A LITTLE WORLD KNOWLEDGE</p>
                <h2>
                  Which city are
                  <br />
                  we looking for?
                </h2>
                <div className="preview-answers">
                  {["Paris", "London", "Rome", "Vienna"].map((answer, i) => (
                    <button
                      key={answer}
                      className={
                        i === 0 ? "preview-answer selected" : "preview-answer"
                      }
                      onClick={() => setModal("practice")}
                    >
                      <span>{LETTERS[i]}</span>
                      {answer}
                      {i === 0 && <Zap size={16} />}
                    </button>
                  ))}
                </div>
                <div className="preview-hint">
                  <span className="hint-bulb">✦</span>
                  <span>A European capital known for art and fashion.</span>
                </div>
              </div>
              <div className="preview-players">
                <div className="avatar-stack">
                  {[0, 1, 2, 3].map((i) => (
                    <Avatar key={i} index={i} small />
                  ))}
                </div>
                <div>
                  <strong>The group chat just got competitive.</strong>
                  <span>Big screen energy. Phone-sized controllers.</span>
                </div>
                <span className="sparkle-mark">✦</span>
              </div>
              <button
                className="demo-link"
                onClick={() => setModal("practice")}
              >
                Try a quick solo round <ArrowRight size={14} />
              </button>
            </div>
          </section>
          <section id="games" className="games-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">SOMETHING FOR EVERYONE</span>
                <h2>Find your party’s competitive side.</h2>
              </div>
              <span className="section-note">
                Same room. Different ways to win.
              </span>
            </div>
            <div className="game-grid">
              {(["mix", "clue", "poll", "board", "list"] as Mode[]).map(
                (mode) => (
                  <button
                    key={mode}
                    className={`game-card ${MODE_META[mode].color} ${mode === "mix" ? "featured" : ""}`}
                    onClick={() => openHost(mode)}
                  >
                    <div className="game-card-top">
                      <span className="mode-symbol">
                        <ModeIcon mode={mode} size={28} />
                      </span>
                      {mode === "mix" ? (
                        <span className="card-badge">THE PARTY STARTER</span>
                      ) : (
                        <ArrowRight size={18} className="card-arrow" />
                      )}
                    </div>
                    <div>
                      <h3>{MODE_META[mode].title}</h3>
                      <span className="game-short">
                        {MODE_META[mode].short}
                      </span>
                      <p>{MODE_META[mode].description}</p>
                    </div>
                    <div className="game-card-bottom">
                      <span>
                        {mode === "board"
                          ? "CURATED ANSWER BOARDS"
                          : mode === "mix"
                            ? "ALL FOUR GAMES"
                            : mode === "clue"
                              ? "KNOWLEDGE + NERVE"
                              : mode === "poll"
                                ? "NO TRIVIA REQUIRED"
                                : "QUICK THINKING"}
                      </span>
                      <ChevronRight size={16} />
                    </div>
                  </button>
                ),
              )}
            </div>
          </section>
          <section className="steps-strip">
            <div className="step-item">
              <span className="step-number">01</span>
              <div>
                <strong>Put us on the big screen.</strong>
                <p>Open SocialBuzz on your laptop or TV browser.</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-number">02</span>
              <div>
                <strong>Get everyone in.</strong>
                <p>Scan the QR code. Pick a name. You’re playing.</p>
              </div>
            </div>
            <div className="step-item">
              <span className="step-number">03</span>
              <div>
                <strong>Let the friendly rivalry begin.</strong>
                <p>Play together. Laugh together. Demand a rematch.</p>
              </div>
            </div>
          </section>
          <footer>
            <span className="footer-brand">
              SocialBuzz<span>.</span>
            </span>
            <span>Made for good company.</span>
            <button className="text-button" onClick={() => setModal("help")}>
              A few things to know <ArrowRight size={13} />
            </button>
          </footer>
        </main>
      ) : !room || !uid ? (
        <main className="loading-state">
          <LoaderCircle className="spin" size={32} />
          <h2>Getting your room ready…</h2>
          <button className="text-button" onClick={goHome}>
            Return home
          </button>
        </main>
      ) : room.state.phase === "closed" ? (
        <main className="end-state">
          <span className="large-symbol">
            <Home size={34} />
          </span>
          <h1>That’s a wrap.</h1>
          <p>
            The host has closed this room. There’s always another game night.
          </p>
          <button className="button primary" onClick={goHome}>
            Back to SocialBuzz
          </button>
        </main>
      ) : (
        <main className={`room-main ${host ? "host-view" : "player-view"}`}>
          <div className="room-topline">
            <span className="room-code-label">
              <span className="live-dot" /> ROOM{" "}
              <button onClick={() => void copy(joinUrl(session.code))}>
                {session.code}
                <Copy size={13} />
              </button>
            </span>
            <span className="room-format">
              {room.settings.teams ? "TEAM PLAY" : "EVERYONE FOR THEMSELVES"}
              <span>·</span>
              {MODE_META[room.settings.mode].title}
            </span>
            <button className="text-button" onClick={() => setModal("leave")}>
              {host ? "End party" : "Leave room"}
            </button>
          </div>
          {room.state.phase === "lobby" ? (
            <Lobby
              room={room}
              code={session.code}
              uid={uid}
              host={!!host}
              players={players}
              busy={busy}
              action={action}
              copy={copy}
            />
          ) : room.state.phase === "finished" ? (
            <Results
              room={room}
              players={players}
              uid={uid}
              host={!!host}
              busy={busy}
              rematch={() => void action(() => api.rematch(session.code))}
              home={goHome}
            />
          ) : question ? (
            <>
              <div className="game-layout">
                <section className="game-stage">
                  <div className="round-heading">
                    <span className={`mini-mode mode-${question.kind}`}>
                      <ModeIcon mode={question.kind} size={17} />
                      {MODE_META[question.kind].title}
                    </span>
                    <span className="round-counter">
                      ROUND <strong>{room.state.round + 1}</strong> /{" "}
                      {room.settings.rounds}
                    </span>
                  </div>
                  <QuestionStage
                    question={question}
                    state={room.state}
                    time={time}
                    answers={answers}
                    players={players}
                  />
                  <div className="stage-bottom">
                    <span>
                      <ShieldCheck size={14} />
                      {question.kind === "board"
                        ? "Curated board · no survey claims"
                        : question.kind === "list"
                          ? "Answers checked against this pack"
                          : question.kind === "poll"
                            ? "Tied majorities both count"
                            : "One answer. Make it count."}
                    </span>
                    {host && (
                      <span>
                        {Object.keys(answers).length} / {players.length} locked
                        in
                      </span>
                    )}
                  </div>
                </section>
                {host ? (
                  <aside className="score-panel">
                    <Leaderboard
                      players={players}
                      state={room.state}
                      teams={room.settings.teams}
                      uid={uid}
                    />
                    <div className="host-controls">
                      <label className="switch-label">
                        <input
                          type="checkbox"
                          checked={auto}
                          onChange={(e) => setAuto(e.target.checked)}
                        />
                        <span>Auto-advance rounds</span>
                      </label>
                      {room.state.phase === "reveal" && (
                        <button
                          className="button primary full"
                          disabled={busy}
                          onClick={() =>
                            void action(() => api.nextRound(session.code, room))
                          }
                        >
                          {busy ? (
                            <LoaderCircle size={17} className="spin" />
                          ) : room.state.round + 1 >= room.settings.rounds ? (
                            <Trophy size={17} />
                          ) : (
                            <ArrowRight size={17} />
                          )}
                          {room.state.round + 1 >= room.settings.rounds
                            ? "Final results"
                            : "Next round"}
                        </button>
                      )}
                      <p>
                        {room.state.phase === "reveal"
                          ? auto
                            ? "Next round starts after 10 seconds. Switch off to take a breather."
                            : "Take your time. Continue when the room is ready."
                          : "Keep this host screen open. Scan the room QR on your phone to play too."}
                      </p>
                    </div>
                  </aside>
                ) : (
                  <section className="controller-panel">
                    <AnswerPad
                      key={`${room.state.round}-${room.state.phase}`}
                      question={question}
                      state={room.state}
                      time={time}
                      existing={answers[uid]}
                      outcome={room.state.outcomes?.[uid]}
                      muted={muted}
                      submit={(value, prediction) =>
                        api.submitAnswer(
                          session.code,
                          room.state.round,
                          value,
                          prediction,
                        )
                      }
                    />
                    <div className="your-score">
                      <Avatar index={room.players?.[uid]?.avatar || 0} small />
                      <strong>{room.players?.[uid]?.name || "Player"}</strong>
                      <span>
                        {(room.state.totals?.[uid] || 0).toLocaleString()}{" "}
                        <small>PTS</small>
                      </span>
                    </div>
                  </section>
                )}
              </div>
              {!host && room.state.phase === "reveal" && (
                <Leaderboard
                  players={players}
                  state={room.state}
                  teams={room.settings.teams}
                  uid={uid}
                />
              )}
            </>
          ) : null}
        </main>
      )}

      {modal === "install" && (
        <Modal title="Install SocialBuzz" close={() => setModal(null)}>
          <div className="dialog-title">
            <span className="dialog-icon">
              <Download />
            </span>
            <h2>Your game night. One tap away.</h2>
            <p>
              Install SocialBuzz for a home-screen icon and its own app window.
              No app store or account needed.
            </p>
          </div>
          {pwa.canPrompt && (
            <button
              className="button primary full"
              onClick={async () => {
                if ((await pwa.install()) === "accepted") setModal(null);
              }}
            >
              <Download size={17} />
              Install SocialBuzz
            </button>
          )}
          <div className="install-instructions">
            <section>
              <span className="install-platform">
                <Smartphone size={19} />
              </span>
              <div>
                <h3>iPhone or iPad</h3>
                <p>
                  Open SocialBuzz in Safari. Tap <strong>Share</strong>, then{" "}
                  <strong>Add to Home Screen</strong>. If shown, keep{" "}
                  <strong>Open as Web App</strong> on, then tap{" "}
                  <strong>Add</strong>.
                </p>
              </div>
            </section>
            <section>
              <span className="install-platform">
                <Smartphone size={19} />
              </span>
              <div>
                <h3>Android</h3>
                <p>
                  Open SocialBuzz in Chrome. Tap the <strong>⋮ menu</strong>,
                  then <strong>Install app</strong> or{" "}
                  <strong>Add to Home screen</strong>.
                </p>
              </div>
            </section>
            <section>
              <span className="install-platform">
                <Download size={19} />
              </span>
              <div>
                <h3>Desktop</h3>
                <p>
                  Open SocialBuzz in Chrome or Edge. Choose the{" "}
                  <strong>install icon</strong> near the address bar, or the
                  install option in the browser’s menu.
                </p>
              </div>
            </section>
          </div>
          <div className="install-browser-note">
            <ExternalLink size={18} />
            <p>
              Using an in-app browser? Open the link in your regular browser to
              install.
            </p>
          </div>
          <button
            className="button secondary full"
            onClick={async () => {
              const url = new URL("./", location.href).href;
              try {
                await navigator.clipboard.writeText(url);
                setToast(
                  "SocialBuzz link copied. Open it in your browser to install.",
                );
              } catch {
                setToast(url);
              }
            }}
          >
            <Copy size={16} />
            Copy app link
          </button>
          <p className="field-note">
            Offline solo practice is included. Multiplayer rooms use an internet
            connection.
          </p>
        </Modal>
      )}
      {modal === "host" && (
        <Modal
          title="Host a party"
          close={() => {
            setModal(null);
            setError("");
          }}
        >
          <div className="dialog-title">
            <span className="dialog-icon">
              <Sparkles />
            </span>
            <h2>Your game night starts here.</h2>
            <p>A little setup. A lot of friendly competition.</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const code = await api.createRoom(settings);
                save("socialbuzz.settings", settings);
                setSession({ code, role: "host" });
                history.replaceState(
                  null,
                  "",
                  location.pathname + "?host=" + code,
                );
                setModal(null);
              });
            }}
          >
            <label className="field-label" htmlFor="mode">
              What are we playing?
            </label>
            <select
              id="mode"
              value={settings.mode}
              onChange={(e) =>
                setSettings({ ...settings, mode: e.target.value as Mode })
              }
            >
              {Object.entries(MODE_META).map(([mode, meta]) => (
                <option key={mode} value={mode}>
                  {meta.title} — {meta.short}
                </option>
              ))}
            </select>
            <div className="form-grid">
              <fieldset>
                <legend>Room size</legend>
                <div className="segmented">
                  {([4, 6] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={settings.capacity === n}
                      onClick={() => setSettings({ ...settings, capacity: n })}
                    >
                      {n} players
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Play style</legend>
                <div className="segmented">
                  <button
                    type="button"
                    aria-pressed={!settings.teams}
                    onClick={() => setSettings({ ...settings, teams: false })}
                  >
                    Individual
                  </button>
                  <button
                    type="button"
                    aria-pressed={settings.teams}
                    onClick={() => setSettings({ ...settings, teams: true })}
                  >
                    2 teams
                  </button>
                </div>
              </fieldset>
            </div>
            <div className="form-grid">
              <div>
                <label className="field-label" htmlFor="rounds">
                  Game length
                </label>
                <select
                  id="rounds"
                  value={settings.rounds}
                  onChange={(e) =>
                    setSettings({ ...settings, rounds: +e.target.value })
                  }
                >
                  <option value={6}>Quick · 6 rounds</option>
                  <option value={9}>Classic · 9 rounds</option>
                  <option value={12}>Encore · 12 rounds</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="pace">
                  The pace
                </label>
                <select
                  id="pace"
                  value={settings.seconds}
                  onChange={(e) =>
                    setSettings({ ...settings, seconds: +e.target.value })
                  }
                >
                  <option value={24}>Classic · 24 seconds</option>
                  <option value={36}>Relaxed · 36 seconds</option>
                </select>
              </div>
            </div>
            {settings.mode === "clue" && (
              <>
                <label className="field-label" htmlFor="category">
                  Favourite category
                </label>
                <select
                  id="category"
                  value={settings.category}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      category: e.target.value as Category,
                    })
                  }
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <p className="field-note">
                  Your category leads; other categories fill longer games.
                </p>
              </>
            )}
            {(settings.mode === "board" || settings.mode === "list") &&
              settings.rounds > 8 && (
                <p className="field-note">
                  This pack has 8 boards. Your game will use all 8 without
                  repeating.
                </p>
              )}
            <div className="inline-note">
              <Wifi size={17} />
              <span>
                Everyone needs internet and a phone browser. You’ll get a room
                code and QR invite.
              </span>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy || !online}>
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              {busy ? "Making room for your people…" : "Create the room"}
              <ArrowRight size={17} />
            </button>
          </form>
        </Modal>
      )}
      {modal === "join" && (
        <Modal
          title="Join a room"
          close={() => {
            setModal(null);
            setError("");
          }}
        >
          <JoinForm
            initialCode={initialCode}
            busy={busy}
            error={error}
            join={(code, name, avatar, team) =>
              void action(async () => {
                await api.joinRoom(code, name, avatar, team);
                save("socialbuzz.player", { name, avatar });
                setSession({ code, role: "player" });
                setModal(null);
              })
            }
          />
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="How to play SocialBuzz" close={() => setModal(null)}>
          <div className="dialog-title">
            <span className="dialog-icon">
              <HelpCircle />
            </span>
            <h2>Good company is all you need.</h2>
            <p>We’ll take care of the game show.</p>
          </div>
          <div className="help-steps">
            <div>
              <span>1</span>
              <section>
                <h3>Host on the big screen</h3>
                <p>
                  Connect a laptop to your TV, or open SocialBuzz in a supported
                  TV browser. Create a room and leave the host screen open.
                </p>
              </section>
            </div>
            <div>
              <span>2</span>
              <section>
                <h3>Phones are the controllers</h3>
                <p>
                  Scan the QR or enter the six-letter room code. Pick an avatar
                  and nickname. The host joins on a phone too.
                </p>
              </section>
            </div>
            <div>
              <span>3</span>
              <section>
                <h3>Everyone gets to play</h3>
                <p>
                  Lock one answer in Clue Chase. In Read the Room, choose your
                  opinion and predict the majority. Write three guesses for
                  Crowd Says or five for List Blitz, separated by commas.
                </p>
              </section>
            </div>
          </div>
          <div className="help-details">
            <h3>A fair bit of friendly rivalry</h3>
            <p>
              Clue Chase awards up to 1,000 points, plus a 100-point speed
              bonus. Wrong guesses earn zero. Read the Room gives 600 for a
              correct prediction, or 100 for participating. Teams combine
              individual scores.
            </p>
            <p>
              Crowd Says uses curated answer boards, not real survey rankings.
              Spelling variants in our answer packs are accepted. Rooms expire
              after six hours. Guest nicknames and answers are stored in
              Firebase; there are no ads or analytics.
            </p>
          </div>
          <button
            className="button primary full"
            onClick={() => setModal(null)}
          >
            Let’s play <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {modal === "practice" && (
        <Modal title="Solo practice" close={() => setModal(null)} wide>
          <Practice muted={muted} />
        </Modal>
      )}
      {modal === "leave" && (
        <Modal
          title={host ? "End this party?" : "Leave this room?"}
          close={() => setModal(null)}
        >
          <div className="dialog-title">
            <span className="dialog-icon">
              <Home />
            </span>
            <h2>{host ? "Call it a night?" : "Heading out?"}</h2>
            <p>
              {host
                ? "Ending the party closes this room for everyone. You can start a fresh one any time."
                : "Leaving removes your player from the room. You can join again while the lobby is open."}
            </p>
          </div>
          <button
            className="button primary full"
            disabled={busy}
            onClick={() => void action(exitRoom)}
          >
            {host ? "End party for everyone" : "Leave room"}
          </button>
          <button className="button ghost full" onClick={() => setModal(null)}>
            Keep playing
          </button>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function JoinForm({
  initialCode,
  busy,
  error,
  join,
}: {
  initialCode: string;
  busy: boolean;
  error: string;
  join: (code: string, name: string, avatar: number, team: number) => void;
}) {
  const saved = readSaved("socialbuzz.player", { name: "", avatar: 0 });
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(saved.name);
  const [avatar, setAvatar] = useState(saved.avatar);
  return (
    <>
      <div className="dialog-title">
        <span className="dialog-icon">
          <Smartphone />
        </span>
        <h2>You’re on the guest list.</h2>
        <p>Find the room code on your host’s screen.</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          join(code, name, avatar, 0);
        }}
      >
        <label className="field-label" htmlFor="room-code">
          Six-letter room code
        </label>
        <input
          id="room-code"
          className="code-input"
          value={code}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          maxLength={6}
          pattern="[A-HJ-NP-Z]{6}"
          required
          placeholder="ABCDEF"
          onChange={(e) =>
            setCode(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z]/g, ""))
          }
        />
        <label className="field-label" htmlFor="nickname">
          What should we call you?
        </label>
        <input
          id="nickname"
          value={name}
          autoComplete="nickname"
          maxLength={18}
          required
          placeholder="Your game-night alter ego"
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset className="avatar-field">
          <legend>Pick your party animal</legend>
          <div className="avatar-picker">
            {AVATARS.map((animal, i) => (
              <button
                type="button"
                key={animal}
                aria-label={`Avatar ${["fox", "panda", "lion", "frog", "octopus", "koala", "unicorn", "tiger"][i]}`}
                aria-pressed={avatar === i}
                onClick={() => setAvatar(i)}
              >
                <Avatar index={i} />
                {avatar === i && (
                  <span className="avatar-check">
                    <Check size={11} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button
          className="button primary full"
          disabled={busy || code.length !== 6 || !name.trim()}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <ArrowRight size={17} />
          )}
          {busy ? "Finding your people…" : "Let me in"}
        </button>
      </form>
    </>
  );
}

function Lobby({
  room,
  code,
  uid,
  host,
  players,
  busy,
  action,
  copy,
}: {
  room: Room;
  code: string;
  uid: string;
  host: boolean;
  players: Player[];
  busy: boolean;
  action: (work: () => Promise<unknown>) => Promise<void>;
  copy: (text: string) => Promise<void>;
}) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    QRCode.toDataURL(joinUrl(code), {
      width: 240,
      margin: 2,
      color: { dark: "#151722", light: "#fff9f2" },
      errorCorrectionLevel: "M",
    })
      .then(setQr)
      .catch(() => {});
  }, [code]);
  const teamCounts = [0, 1].map(
    (t) => players.filter((p) => p.team === t).length,
  );
  const balanced =
    !room.settings.teams ||
    (teamCounts[0] === teamCounts[1] && teamCounts[0] > 0);
  return (
    <div className="lobby-layout">
      <section className="lobby-main">
        <div className="pill">
          <Sparkles size={13} /> THE BEST PART IS WHO’S HERE
        </div>
        <h1>
          {host ? "Make room for" : "You’re in."}
          <br />
          <span>{host ? "a little rivalry." : "Bring your best."}</span>
        </h1>
        <p className="lobby-description">
          {host
            ? "Get everyone connected. The bragging rights can wait a minute."
            : "Keep this screen open. Your host will start the party when everyone’s ready."}
        </p>
        <div className="players-heading">
          <h3>
            The guest list{" "}
            <span>
              {players.length}/{room.settings.capacity}
            </span>
          </h3>
          {room.settings.teams && (
            <span className="small-muted">Pick your side below</span>
          )}
        </div>
        <div className="lobby-players">
          {Array.from({ length: room.settings.capacity }, (_, i) => {
            const player = players[i];
            return player ? (
              <div key={player.uid} className="player-slot filled">
                <Avatar index={player.avatar} />
                <div>
                  <strong>
                    {player.name}
                    {player.uid === uid && <small> YOU</small>}
                  </strong>
                  <span>
                    {room.settings.teams
                      ? player.team === 0
                        ? "Team Coral"
                        : "Team Mint"
                      : player.online
                        ? "Ready for the rivalry"
                        : "Reconnecting…"}
                  </span>
                </div>
                {host ? (
                  <button
                    className="icon-button remove-player"
                    aria-label={`Remove ${player.name}`}
                    onClick={() =>
                      void action(() => api.removePlayer(code, player.uid))
                    }
                  >
                    <X size={15} />
                  </button>
                ) : (
                  <CheckCircle2 size={18} className="ready-check" />
                )}
              </div>
            ) : (
              <div className="player-slot empty" key={i}>
                <span className="empty-avatar">
                  <Users size={20} />
                </span>
                <span>Saving a spot…</span>
                <span className="waiting-dots">•••</span>
              </div>
            );
          })}
        </div>
        {room.settings.teams && (
          <div className="team-picker">
            <span>{host ? "Assign teams" : "Choose your team"}</span>
            {host ? (
              players.map((p) => (
                <label key={p.uid}>
                  <span>{p.name}</span>
                  <select
                    aria-label={`Team for ${p.name}`}
                    value={p.team}
                    onChange={(e) =>
                      void action(() =>
                        api.changeTeam(code, p.uid, +e.target.value),
                      )
                    }
                  >
                    <option value={0}>Coral</option>
                    <option value={1}>Mint</option>
                  </select>
                </label>
              ))
            ) : (
              <div className="segmented">
                {[0, 1].map((team) => (
                  <button
                    key={team}
                    aria-pressed={room.players?.[uid]?.team === team}
                    onClick={() =>
                      void action(() => api.changeTeam(code, uid, team))
                    }
                  >
                    {team === 0 ? "Team Coral" : "Team Mint"} ·{" "}
                    {teamCounts[team]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="lobby-footer">
          <span className={`mode-chip ${MODE_META[room.settings.mode].color}`}>
            <ModeIcon mode={room.settings.mode} size={17} />
            {MODE_META[room.settings.mode].title}
          </span>
          <span>{room.settings.rounds} rounds</span>
          <span>
            {room.settings.seconds === 36 ? "Relaxed pace" : "Classic pace"}
          </span>
        </div>
        {host ? (
          <>
            <button
              className="button primary start-party"
              disabled={busy || players.length < 2 || !balanced}
              onClick={() => void action(() => api.nextRound(code, room))}
            >
              <Play size={18} fill="currentColor" />
              {busy ? "Here we go…" : "Start the party"}
              <ArrowRight size={19} />
            </button>
            <p className="field-note">
              {players.length < 2
                ? "At least 2 players to start. Four to six makes a great party."
                : !balanced
                  ? "Give both teams the same number of players to start."
                  : "Everyone here? You’re ready. The host can join on a phone too."}
            </p>
          </>
        ) : (
          <div className="waiting-for-host">
            <span className="live-dot" /> Waiting for your host to start…
          </div>
        )}
      </section>
      <aside className="invite-panel">
        <span className="eyebrow">YOUR INVITATION TO GAME NIGHT</span>
        <h2>Scan. Join. Game on.</h2>
        <div className="qr-frame">
          {qr ? (
            <img
              src={qr}
              width={220}
              height={220}
              alt={`QR code to join SocialBuzz room ${code}`}
            />
          ) : (
            <LoaderCircle className="spin" />
          )}
        </div>
        <span className="code-caption">OR ENTER THE ROOM CODE</span>
        <strong className="big-room-code">{code}</strong>
        <button
          className="button secondary full"
          onClick={() => void copy(joinUrl(code))}
        >
          <Copy size={16} />
          Copy invite link
        </button>
        <div className="invite-note">
          <Smartphone size={24} />
          <p>
            One phone per player.
            <br />
            No accounts. No downloads.
            <br />
            Just your most competitive friends.
          </p>
        </div>
      </aside>
    </div>
  );
}

function QuestionStage({
  question,
  state,
  time,
  answers,
  players,
}: {
  question: Question;
  state: GameState;
  time: number;
  answers: Record<string, Answer>;
  players: Player[];
}) {
  const remaining = Math.max(0, Math.ceil((state.deadline - time) / 1000));
  const countdown = Math.max(0, Math.ceil((state.startedAt - time) / 1000));
  const duration = state.deadline - state.startedAt;
  const elapsed = Math.max(0, time - state.startedAt);
  const hints = Math.min(3, Math.floor(elapsed / (duration / 4)));
  const revealed = state.phase === "reveal";
  const counts =
    state.votes ||
    question.options?.map(
      (_, i) => Object.values(answers).filter((a) => a.value === i).length,
    ) ||
    [];
  return (
    <div className={`question-content ${revealed ? "is-revealed" : ""}`}>
      <div className="question-meta">
        <span>
          {question.kind === "poll"
            ? "CHOOSE YOUR OPINION. PREDICT THE MAJORITY."
            : question.kind === "board"
              ? "THREE GUESSES. A HIDDEN ANSWER BOARD."
              : question.kind === "list"
                ? "FIVE GUESSES. UNIQUE ANSWERS SCORE MORE."
                : question.category.toUpperCase()}
        </span>
        <span
          className={`timer ${remaining <= 5 && !revealed ? "urgent" : ""}`}
        >
          <Clock3 size={17} />
          {revealed ? "REVEAL" : countdown > 0 ? "GET READY" : `${remaining}s`}
        </span>
      </div>
      <h1 className="question-title">{question.prompt}</h1>
      {!revealed && (
        <div
          className="timer-track"
          role="progressbar"
          aria-label="Time remaining"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration / 1000)}
          aria-valuenow={remaining}
        >
          <span
            style={{
              width: `${Math.min(100, Math.max(0, (100 * (state.deadline - time)) / duration))}%`,
            }}
          />
        </div>
      )}
      {countdown > 0 && !revealed ? (
        <div className="countdown" aria-live="polite">
          <span>{countdown}</span>
          <p>Eyes up. Phones ready.</p>
        </div>
      ) : (
        <>
          {question.options ? (
            <div className="stage-options">
              {question.options.map((option, i) => (
                <div
                  key={option}
                  className={`stage-option ${revealed && question.kind === "clue" && question.answer === i ? "correct" : ""}`}
                >
                  <span className="option-letter">{LETTERS[i]}</span>
                  <strong>{option}</strong>
                  {revealed &&
                    question.kind === "clue" &&
                    question.answer === i && <CheckCircle2 size={22} />}
                  {revealed && question.kind === "poll" && (
                    <span className="vote-count">
                      {counts[i]} vote{counts[i] === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="answer-board">
              {question.entries?.map((entry, i) => (
                <div
                  className={`board-entry ${revealed ? "flipped" : ""}`}
                  key={entry.label}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>{revealed ? entry.label : "• • • • •"}</strong>
                  {revealed && question.kind === "board" && <small>250</small>}
                </div>
              ))}
            </div>
          )}
          {question.kind === "clue" && !revealed && (
            <div className="clues">
              <div className="clue-header">
                <span>
                  <Sparkles size={15} /> A LITTLE HELP?
                </span>
                <strong>
                  {availablePoints(
                    state.startedAt,
                    state.deadline,
                    time,
                  ).toLocaleString()}{" "}
                  <small>PTS AVAILABLE</small>
                </strong>
              </div>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`clue-line ${i < hints ? "unlocked" : ""}`}
                >
                  <span>
                    {i < hints ? (
                      <Sparkles size={14} />
                    ) : (
                      <LockKeyhole size={13} />
                    )}
                  </span>
                  <p>
                    {i < hints
                      ? question.hints?.[i]
                      : `Clue ${i + 1} unlocks in ${Math.max(0, Math.ceil((((i + 1) * duration) / 4 - elapsed) / 1000))}s`}
                  </p>
                </div>
              ))}
            </div>
          )}
          {revealed && (
            <div className="reveal-explanation" aria-live="polite">
              <span>
                <CheckCircle2 size={20} />
              </span>
              <p>{state.revealText}</p>
            </div>
          )}
          {!revealed && question.kind !== "clue" && (
            <div className="round-instruction">
              <Smartphone size={19} />
              <p>
                {question.kind === "poll"
                  ? "Make your choice on your phone, then tell us what you think the room will choose."
                  : `Send ${question.kind === "board" ? "three" : "up to five"} answers on your phone, separated by commas. One submission, so make it count.`}
              </p>
            </div>
          )}
        </>
      )}
      {players.length === 0 && (
        <p className="field-note">Waiting for players to reconnect.</p>
      )}
    </div>
  );
}

function AnswerPad({
  question,
  state,
  time,
  existing,
  outcome,
  muted,
  submit,
}: {
  question: Question;
  state: GameState;
  time: number;
  existing?: Answer;
  outcome?: GameState["outcomes"][string];
  muted: boolean;
  submit: (value: string | number, prediction?: number) => Promise<void>;
}) {
  const [choice, setChoice] = useState<number | null>(null);
  const [prediction, setPrediction] = useState<number | null>(null);
  const [words, setWords] = useState("");
  const [sending, setSending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const lockedIn = !!existing || locked;
  const ready =
    time >= state.startedAt &&
    time <= state.deadline &&
    state.phase === "question";
  async function send(value: number | string, guess?: number) {
    if (!ready || lockedIn || sending) return;
    setSending(true);
    setError("");
    try {
      await submit(value, guess);
      setLocked(true);
      tone(true, muted);
      if (navigator.vibrate) navigator.vibrate(35);
    } catch {
      setError(
        "That answer didn’t lock. Check your connection and try again before time runs out.",
      );
    } finally {
      setSending(false);
    }
  }
  if (state.phase === "reveal")
    return (
      <div
        className={`personal-result ${outcome?.correct ? "right" : ""}`}
        aria-live="polite"
      >
        <span className="result-icon">
          {outcome?.correct ? <Trophy size={30} /> : <RotateCcw size={30} />}
        </span>
        <span className="eyebrow">
          {outcome?.fastest
            ? "QUICK THINKING PAYS OFF"
            : outcome?.correct
              ? "NICELY PLAYED"
              : "NEXT ROUND, YOUR ROUND"}
        </span>
        <h2>
          +{outcome?.points || 0}
          <small> pts</small>
        </h2>
        <p>{outcome?.label || "No answer this round"}</p>
        <span className="small-muted">
          Look up. The reveal is on the big screen.
        </span>
      </div>
    );
  if (lockedIn)
    return (
      <div className="locked-state" aria-live="polite">
        <span className="result-icon">
          <LockKeyhole size={28} />
        </span>
        <h2>Locked and loaded.</h2>
        <p>Your answer is in. Now for the suspense.</p>
        <span className="pill">
          <Check size={13} /> ANSWER SAVED
        </span>
      </div>
    );
  return (
    <div className="answer-pad">
      <span className="eyebrow">
        {question.kind === "poll"
          ? "YOUR OPINION, THEN YOUR PREDICTION"
          : question.options
            ? "TAP ONCE TO LOCK IT IN"
            : "YOUR ANSWERS"}
      </span>
      {question.options ? (
        <>
          {question.kind === "poll" && (
            <label className="field-label">First, what would you choose?</label>
          )}
          <div className="phone-options">
            {question.options.map((option, i) => (
              <button
                key={option}
                className={`phone-option ${choice === i ? "selected" : ""}`}
                disabled={!ready || sending}
                aria-pressed={
                  question.kind === "poll" ? choice === i : undefined
                }
                onClick={() => {
                  if (question.kind === "clue") void send(i);
                  else setChoice(i);
                }}
              >
                <span>{LETTERS[i]}</span>
                {option}
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
          {question.kind === "poll" && (
            <>
              <label className="field-label" htmlFor="prediction">
                Now, what will most of the room choose?
              </label>
              <select
                id="prediction"
                value={prediction ?? ""}
                disabled={!ready || sending}
                onChange={(e) => setPrediction(+e.target.value)}
              >
                <option value="" disabled>
                  Predict the majority…
                </option>
                {question.options.map((option, i) => (
                  <option key={option} value={i}>
                    {option}
                  </option>
                ))}
              </select>
              <button
                className="button primary full"
                disabled={
                  !ready || sending || choice === null || prediction === null
                }
                onClick={() => void send(choice!, prediction!)}
              >
                <LockKeyhole size={16} />
                Lock both answers
              </button>
            </>
          )}
        </>
      ) : (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void send(words.trim());
          }}
        >
          <label className="field-label" htmlFor="word-answers">
            {question.kind === "board" ? "Up to 3 answers" : "Up to 5 answers"}{" "}
            · separate with commas
          </label>
          <textarea
            id="word-answers"
            value={words}
            disabled={!ready || sending}
            onChange={(e) => setWords(e.target.value)}
            maxLength={240}
            rows={4}
            placeholder="Your first answer, your second answer…"
          />
          <p className="field-note">
            {question.kind === "board"
              ? "250 points for each answer on the curated board."
              : "150 per match. 100 extra for each answer only you find."}
          </p>
          <button
            className="button primary full"
            disabled={
              !ready ||
              sending ||
              !words.trim() ||
              words.split(",").filter((w) => w.trim()).length >
                (question.kind === "board" ? 3 : 5)
            }
          >
            <LockKeyhole size={16} />
            Lock my list
          </button>
        </form>
      )}
      {!ready && (
        <p className="field-note">
          {time < state.startedAt
            ? "Get ready… answers open after the countdown."
            : "Time’s up. Waiting for the host to reveal."}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {sending && (
        <p className="field-note">
          <LoaderCircle className="spin" size={14} /> Locking your answer…
        </p>
      )}
    </div>
  );
}

function Leaderboard({
  players,
  state,
  teams,
  uid,
}: {
  players: Player[];
  state: GameState;
  teams: boolean;
  uid: string;
}) {
  const sorted = [...players].sort(
    (a, b) => (state.totals?.[b.uid] || 0) - (state.totals?.[a.uid] || 0),
  );
  const totals = teamTotals(players, state.totals || {});
  return (
    <div className="leaderboard">
      <div className="leaderboard-title">
        <Trophy size={17} />
        <h3>The standings</h3>
      </div>
      {teams && (
        <div className="team-scores">
          {[0, 1].map((team) => (
            <div key={team} className={team ? "mint-text" : "coral-text"}>
              <span>TEAM {team ? "MINT" : "CORAL"}</span>
              <strong>{totals[team].toLocaleString()}</strong>
            </div>
          ))}
        </div>
      )}
      <ol>
        {sorted.map((p, i) => (
          <li key={p.uid} className={p.uid === uid ? "is-you" : ""}>
            <span className="rank">
              {i === 0 && (state.totals?.[p.uid] || 0) > 0 ? (
                <Crown size={16} />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <Avatar index={p.avatar} small />
            <div>
              <strong>
                {p.name}
                {p.uid === uid && <small> YOU</small>}
              </strong>
              <span>
                {state.phase === "reveal"
                  ? `+${state.outcomes?.[p.uid]?.points || 0} this round`
                  : teams
                    ? p.team
                      ? "Team Mint"
                      : "Team Coral"
                    : p.online
                      ? "In the game"
                      : "Reconnecting"}
              </span>
            </div>
            <b>{(state.totals?.[p.uid] || 0).toLocaleString()}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Results({
  room,
  players,
  uid,
  host,
  busy,
  rematch,
  home,
}: {
  room: Room;
  players: Player[];
  uid: string;
  host: boolean;
  busy: boolean;
  rematch: () => void;
  home: () => void;
}) {
  const scores = room.state.totals || {};
  const max = Math.max(0, ...players.map((p) => scores[p.uid] || 0));
  const winners = players.filter((p) => (scores[p.uid] || 0) === max);
  const teams = teamTotals(players, scores);
  const title = room.settings.teams
    ? teams[0] === teams[1]
      ? "Shared bragging rights."
      : `Team ${teams[0] > teams[1] ? "Coral" : "Mint"} takes it.`
    : winners.length === 1
      ? `${winners[0].name} takes the crown.`
      : "Shared bragging rights.";
  return (
    <div className="results-layout">
      <section className="results-celebration">
        <span className="trophy-orbit">
          <Trophy size={58} strokeWidth={1.5} />
        </span>
        <span className="eyebrow">THE BRAGGING RIGHTS ARE OFFICIAL</span>
        <h1>{title}</h1>
        <p>
          {room.settings.rounds} rounds. One great group.
          <br />
          Same time next game night?
        </p>
        <div className="winner-avatars">
          {(room.settings.teams
            ? players.filter(
                (p) =>
                  teams[0] === teams[1] ||
                  p.team === (teams[0] > teams[1] ? 0 : 1),
              )
            : winners
          ).map((p) => (
            <Avatar key={p.uid} index={p.avatar} />
          ))}
        </div>
        {host ? (
          <button className="button primary" disabled={busy} onClick={rematch}>
            <RotateCcw size={17} /> Back to lobby for a rematch
          </button>
        ) : (
          <div className="waiting-for-host">
            Waiting for your host to start a rematch…
          </div>
        )}
        <button className="text-button" onClick={home}>
          <ArrowLeft size={15} />
          Back to SocialBuzz
        </button>
      </section>
      <aside className="score-panel">
        <Leaderboard
          players={players}
          state={room.state}
          teams={room.settings.teams}
          uid={uid}
        />
      </aside>
    </div>
  );
}

function Practice({ muted }: { muted: boolean }) {
  const [index, setIndex] = useState(0);
  const question = QUESTIONS.filter((q) => q.kind === "clue")[index % 30];
  const [state, setState] = useState(() =>
    questionState(
      0,
      question,
      { ...DEFAULT_SETTINGS, seconds: 24 },
      api.now() - 3000,
      {},
    ),
  );
  const time = useTick();
  const player: Player = {
    uid: "practice",
    name: "You",
    avatar: 0,
    team: 0,
    slot: 0,
    joinedAt: 0,
    online: true,
  };
  useEffect(() => {
    if (time > state.deadline && state.phase === "question") finish();
  }, [time]);
  function finish(answer?: Answer) {
    const scored = scoreRound(
      question,
      state,
      [player],
      answer ? { practice: answer } : {},
    );
    setState((s) => ({ ...s, ...scored, phase: "reveal" }));
  }
  return (
    <div className="practice">
      <div className="practice-label">
        <span className="eyebrow">SOLO PRACTICE</span>
        <span>No room needed. Just a little nerve.</span>
      </div>
      <QuestionStage
        question={question}
        state={state}
        time={time}
        answers={{}}
        players={[player]}
      />
      {state.phase === "question" ? (
        <div className="practice-options">
          {question.options?.map((option, i) => (
            <button
              className="phone-option"
              key={option}
              onClick={() => {
                tone(i === question.answer, muted);
                finish({ value: i, at: api.now() });
              }}
            >
              <span>{LETTERS[i]}</span>
              {option}
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      ) : (
        <div className="practice-result">
          <strong>+{state.outcomes.practice?.points || 0} points</strong>
          <button
            className="button primary"
            onClick={() => {
              const next = (index + 1) % 30;
              setIndex(next);
              setState(
                questionState(
                  next,
                  QUESTIONS.filter((q) => q.kind === "clue")[next],
                  DEFAULT_SETTINGS,
                  api.now() - 3000,
                  {},
                ),
              );
            }}
          >
            Another round <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
