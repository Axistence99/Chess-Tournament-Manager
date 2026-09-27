/** Unit tests for PGN metadata, colors, results, and move placeholders. */
import { describe, expect, it } from "vitest";
import type { AppState } from "../models";
import { pgn } from "./pgnExporter";

const state: AppState = {
  tournament: {
    id: "event",
    name: 'Club "Open"',
    venue: "Main Hall",
    organizer: "Arbiter",
    date: "2026-09-28",
    timeControl: "15+10",
    totalRounds: 1,
    type: "Swiss System",
    createdAt: "2026-09-28",
    finished: true,
  },
  players: [
    {
      id: "w",
      name: "White Player",
      rating: 1800,
      age: 20,
      club: "",
      country: "PHI",
      fideId: "",
      ageCategory: "Open",
      active: true,
    },
    {
      id: "b",
      name: "Black Player",
      rating: 1750,
      age: 20,
      club: "",
      country: "JPN",
      fideId: "",
      ageCategory: "Open",
      active: true,
    },
  ],
  rounds: [
    {
      number: 1,
      locked: true,
      completed: true,
      createdAt: "2026-09-28",
      pairings: [
        {
          id: "g",
          board: 1,
          whiteId: "w",
          blackId: "b",
          result: "1-0",
          locked: true,
        },
      ],
    },
  ],
  view: "standings",
};

describe("PGN exporter", () => {
  it("writes required tags, escapes quotes and emits a valid result token", () => {
    const output = pgn(state);
    expect(output).toContain('[Event "Club \\"Open\\""]');
    expect(output).toContain('[Site "Main Hall"]');
    expect(output).toContain('[Date "2026.09.28"]');
    expect(output).toContain('[WhiteElo "1800"]');
    expect(output).toContain('[BlackElo "1750"]');
    expect(output).toContain('[TimeControl "15+10"]');
    expect(output.trim().endsWith("1-0")).toBe(true);
  });
});
