export type Mode = "mix" | "clue" | "poll" | "board" | "list";
export type Phase =
  | "lobby"
  | "preparing"
  | "countdown"
  | "question"
  | "reveal"
  | "finished"
  | "closed";
export type Category =
  | "All categories"
  | "Everyday"
  | "World"
  | "Science"
  | "Entertainment"
  | "Sports";
export interface Settings {
  mode: Mode;
  capacity: 4 | 6;
  teams: boolean;
  rounds: number;
  seconds: number;
  category: Category;
}
export interface Question {
  id: string;
  kind: Exclude<Mode, "mix">;
  category: Category;
  prompt: string;
  options?: string[];
  answer?: number;
  hints?: string[];
  explanation: string;
  entries?: { label: string; aliases: string[] }[];
}
export interface Player {
  uid: string;
  name: string;
  avatar: number;
  team: number;
  slot: number;
  joinedAt: number;
  online: boolean;
}
export interface Answer {
  value: number | string;
  at: number;
  prediction?: number;
}
export interface Outcome {
  uid: string;
  points: number;
  correct: boolean;
  label: string;
  fastest: boolean;
}
export interface GameState {
  phase: Phase;
  round: number;
  questionId: string;
  startedAt: number;
  deadline: number;
  totals: Record<string, number>;
  outcomes: Record<string, Outcome>;
  revealText: string;
  votes?: number[];
  syncToken?: string;
  countdownDigit?: number;
  countdownAt?: number;
}
export interface RoundReady {
  token: string;
  step: number;
  at: number;
  version: string;
}
export interface Room {
  hostId: string;
  createdAt: number;
  expiresAt: number;
  deckSeed?: string;
  settings: Settings;
  state: GameState;
  players?: Record<string, Player>;
  submissions?: Record<string, Record<string, Answer>>;
  roundReady?: Record<string, RoundReady>;
}
export interface Session {
  code: string;
  role: "host" | "player";
}
export const DEFAULT_SETTINGS: Settings = {
  mode: "mix",
  capacity: 6,
  teams: false,
  rounds: 9,
  seconds: 24,
  category: "All categories",
};
