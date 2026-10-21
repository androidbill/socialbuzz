import { describe, expect, it } from 'vitest';
import { availablePoints, deckFor, matchEntries, questionState, scoreRound, teamTotals } from '../src/engine';
import { BY_ID, QUESTIONS } from '../src/questions';
import { DEFAULT_SETTINGS, type Player } from '../src/types';
const players: Player[] = ['one', 'two', 'three', 'four'].map((uid, i) => ({ uid, name: uid, avatar: i, slot: i, team: i % 2, joinedAt: 0, online: true }));
describe('party scoring', () => {
  it('decreases points, with a floor and ceiling', () => { expect(availablePoints(1000, 25000, 0)).toBe(1000); expect(availablePoints(1000, 25000, 13000)).toBe(625); expect(availablePoints(1000, 25000, 50000)).toBe(250); });
  it('gives a speed bonus only to the earliest correct answers within 200 ms', () => {
    const q = BY_ID.c01; const state = questionState(0, q, DEFAULT_SETTINGS, 0, {});
    const scored = scoreRound(q, state, players, { one: { value: q.answer!, at: 4000 }, two: { value: q.answer!, at: 4150 }, three: { value: q.answer!, at: 4500 }, four: { value: 2, at: 3500 } });
    expect(scored.outcomes.one.fastest).toBe(true); expect(scored.outcomes.two.fastest).toBe(true); expect(scored.outcomes.three.fastest).toBe(false); expect(scored.outcomes.four.points).toBe(0);
  });
  it('ignores answers before the start, after the deadline, and from nonplayers', () => {
    const q = BY_ID.c01; const state = questionState(0, q, DEFAULT_SETTINGS, 0, {});
    const scored = scoreRound(q, state, players, { one: { value: 0, at: 2000 }, two: { value: 0, at: state.deadline + 1 }, outsider: { value: 0, at: 4000 } });
    expect(Object.values(scored.outcomes).every(x => x.points === 0)).toBe(true); expect(scored.outcomes.outsider).toBeUndefined();
  });
  it('handles poll ties and awards participation separately from correct predictions', () => {
    const q = BY_ID.p01; const state = questionState(0, q, DEFAULT_SETTINGS, 0, {});
    const scored = scoreRound(q, state, players, { one: { value: 0, prediction: 0, at: 4000 }, two: { value: 1, prediction: 1, at: 4000 }, three: { value: 0, prediction: 2, at: 4000 }, four: { value: 1, prediction: 0, at: 4000 } });
    expect(scored.outcomes.one.points).toBe(600); expect(scored.outcomes.two.points).toBe(600); expect(scored.outcomes.three.points).toBe(100); expect(scored.revealText).toContain('tie'); expect(scored.votes).toEqual([2, 2, 0, 0]);
  });
  it('accepts curated aliases, removes duplicate guesses, and caps answer counts', () => { expect(matchEntries(BY_ID.b01, 'sunblock, SUNSCREEN, shades')).toEqual([0, 3]); expect(matchEntries(BY_ID.l01, 'Mercury, Venus, Earth, Mars, Jupiter, Saturn')).toEqual([0, 1, 2, 3, 4]); });
  it('awards unique list bonuses across canonical aliases', () => {
    const q = BY_ID.l05; const state = questionState(0, q, DEFAULT_SETTINGS, 0, {});
    const scored = scoreRound(q, state, players, { one: { value: 'lake superior, lake erie', at: 4000 }, two: { value: 'superior', at: 4000 } });
    expect(scored.outcomes.one.points).toBe(400); expect(scored.outcomes.two.points).toBe(150);
  });
  it('adds individual scores to the right teams', () => { expect(teamTotals(players, { one: 500, two: 300, three: 200, four: 100 })).toEqual([700, 400]); });
  it('creates a stable deck without repetitions when the pack is large enough', () => { const deck = deckFor(DEFAULT_SETTINGS, 'ABCDEF'); expect(deck).toEqual(deckFor(DEFAULT_SETTINGS, 'ABCDEF')); expect(new Set(deck.map(q => q.id)).size).toBe(9); expect(deck.some(q => q.kind === 'poll')).toBe(true); expect(deck.some(q => q.kind === 'board')).toBe(true); expect(deck.some(q => q.kind === 'list')).toBe(true); });
  it('every question has a complete and valid answer pack', () => { QUESTIONS.forEach(q => { if (q.kind === 'clue') { expect(q.options).toHaveLength(4); expect(q.hints).toHaveLength(3); expect(q.answer).toBeGreaterThanOrEqual(0); expect(q.answer).toBeLessThan(4); } if (q.kind === 'poll') expect(q.options).toHaveLength(4); if (q.entries) expect(q.entries.length).toBeGreaterThanOrEqual(4); }); expect(new Set(QUESTIONS.map(q => q.id)).size).toBe(QUESTIONS.length); });
});
