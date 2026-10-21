import { QUESTIONS } from "./questions";
import type {
  Answer,
  GameState,
  Outcome,
  Player,
  Question,
  Settings,
} from "./types";

export function hash(text: string): number {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
export function shuffleQuestion(question: Question, seed: string): Question {
  if (!question.options) return question;
  const order = question.options
    .map((text, index) => ({ text, index }))
    .sort(
      (a, b) =>
        hash(seed + question.id + a.text) - hash(seed + question.id + b.text),
    );
  return {
    ...question,
    options: order.map((x) => x.text),
    ...(question.answer !== undefined
      ? { answer: order.findIndex((x) => x.index === question.answer) }
      : {}),
  };
}
export function deckFor(settings: Settings, seed: string): Question[] {
  const shuffled = [...QUESTIONS].sort(
    (a, b) => hash(seed + a.id) - hash(seed + b.id),
  );
  const kinds =
    settings.mode === "mix"
      ? [
          "clue",
          "poll",
          "clue",
          "board",
          "clue",
          "poll",
          "list",
          "clue",
          "poll",
        ]
      : [settings.mode];
  const used = new Set<string>();
  return Array.from({ length: settings.rounds }, (_, i) => {
    const kind = kinds[i % kinds.length];
    let pool = shuffled.filter((q) => q.kind === kind && !used.has(q.id));
    const filtered = pool.filter((q) => q.category === settings.category);
    if (settings.category !== "All categories" && filtered.length)
      pool = filtered;
    const q = pool[0] || shuffled.find((q) => q.kind === kind)!;
    used.add(q.id);
    return shuffleQuestion(q, seed);
  });
}
export function questionState(
  round: number,
  question: Question,
  settings: Settings,
  now: number,
  totals: Record<string, number>,
): GameState {
  const duration =
    question.kind === "board" || question.kind === "list"
      ? Math.max(35, settings.seconds)
      : settings.seconds;
  return {
    phase: "question",
    round,
    questionId: question.id,
    startedAt: now + 3000,
    deadline: now + 3000 + duration * 1000,
    totals,
    outcomes: {},
    revealText: "",
  };
}
export function availablePoints(
  start: number,
  end: number,
  at: number,
): number {
  return Math.max(
    250,
    Math.min(
      1000,
      Math.round(1000 - (750 * (at - start)) / Math.max(1, end - start)),
    ),
  );
}
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
export function matchEntries(question: Question, value: string): number[] {
  const guesses = value
    .split(",")
    .map(normalize)
    .filter(Boolean)
    .slice(0, question.kind === "board" ? 3 : 5);
  return (question.entries || []).flatMap((entry, index) =>
    entry.aliases.some((alias) => guesses.includes(normalize(alias)))
      ? [index]
      : [],
  );
}
export function scoreRound(
  question: Question,
  state: GameState,
  players: Player[],
  answers: Record<string, Answer>,
): Pick<GameState, "outcomes" | "totals" | "revealText" | "votes"> {
  const valid = Object.entries(answers).filter(
    ([uid, a]) =>
      players.some((p) => p.uid === uid) &&
      a.at >= state.startedAt &&
      a.at <= state.deadline,
  );
  const outcomes: Record<string, Outcome> = Object.fromEntries(
    players.map((p) => [
      p.uid,
      {
        uid: p.uid,
        points: 0,
        correct: false,
        label: "No answer this round",
        fastest: false,
      },
    ]),
  );
  let revealText = question.explanation;
  let votes: number[] = [];
  if (question.kind === "clue") {
    const correct = valid
      .filter(([, a]) => a.value === question.answer)
      .sort((a, b) => a[1].at - b[1].at);
    // A shared speed bonus for answers received within 200 ms avoids false precision.
    valid.forEach(([uid, answer]) => {
      const right = answer.value === question.answer;
      const fastest = right && answer.at <= (correct[0]?.[1].at ?? 0) + 200;
      outcomes[uid] = {
        uid,
        correct: right,
        fastest,
        points: right
          ? availablePoints(state.startedAt, state.deadline, answer.at) +
            (fastest ? 100 : 0)
          : 0,
        label: question.options?.[Number(answer.value)] || "No answer",
      };
    });
  } else if (question.kind === "poll") {
    const counts = (question.options || []).map(
      (_, i) => valid.filter(([, a]) => a.value === i).length,
    );
    votes = counts;
    const max = Math.max(0, ...counts);
    const winners = counts.flatMap((n, i) => (max > 0 && n === max ? [i] : []));
    valid.forEach(([uid, answer]) => {
      const right = winners.includes(answer.prediction ?? -1);
      outcomes[uid] = {
        uid,
        correct: right,
        fastest: false,
        points: right ? 600 : 100,
        label: `Predicted ${question.options?.[answer.prediction ?? -1] || "nothing"}`,
      };
    });
    revealText = max
      ? `The room chose ${winners.map((i) => question.options![i]).join(" and ")}. ${max} of ${valid.length} votes${winners.length > 1 ? " — a tie!" : "."}`
      : "Nobody voted this round.";
  } else {
    const matched = Object.fromEntries(
      valid.map(([uid, a]) => [uid, matchEntries(question, String(a.value))]),
    );
    valid.forEach(([uid]) => {
      const entries = matched[uid];
      const uniques = entries.filter(
        (i) =>
          Object.values(matched).filter((list) => list.includes(i)).length ===
          1,
      ).length;
      outcomes[uid] = {
        uid,
        correct: entries.length > 0,
        fastest: false,
        points:
          question.kind === "board"
            ? entries.length * 250
            : entries.length * 150 + uniques * 100,
        label: entries.length
          ? `${entries.length} match${entries.length === 1 ? "" : "es"}${question.kind === "list" ? ` · ${uniques} unique` : ""}`
          : "No matches on this board",
      };
    });
  }
  const totals = { ...state.totals };
  players.forEach((p) => {
    totals[p.uid] = (totals[p.uid] || 0) + outcomes[p.uid].points;
  });
  return { outcomes, totals, revealText, votes };
}
export function teamTotals(
  players: Player[],
  totals: Record<string, number>,
): number[] {
  return [0, 1].map((team) =>
    players
      .filter((p) => p.team === team)
      .reduce((sum, p) => sum + (totals[p.uid] || 0), 0),
  );
}
