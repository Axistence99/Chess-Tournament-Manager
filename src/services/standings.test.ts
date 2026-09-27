/** Unit tests for points, ranking order, and tie-break calculations. */
import { describe, expect, it } from "vitest";
import type { Player, Round } from "../models";
import { standings } from "./standings";

const roster: Player[] = [
  {
    id: "a",
    name: "Alpha",
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
    name: "Beta",
    rating: 1700,
    age: 20,
    club: "",
    country: "JPN",
    fideId: "",
    ageCategory: "Open",
    active: true,
  },
  {
    id: "c",
    name: "Gamma",
    rating: 1600,
    age: 20,
    club: "",
    country: "NGR",
    fideId: "",
    ageCategory: "Open",
    active: true,
  },
  {
    id: "d",
    name: "Delta",
    rating: 1500,
    age: 20,
    club: "",
    country: "USA",
    fideId: "",
    ageCategory: "Open",
    active: true,
  },
];

const rounds: Round[] = [
  {
    number: 1,
    locked: true,
    completed: true,
    createdAt: "2026-01-01",
    pairings: [
      {
        id: "1",
        board: 1,
        whiteId: "a",
        blackId: "b",
        result: "1-0",
        locked: true,
      },
      {
        id: "2",
        board: 2,
        whiteId: "c",
        blackId: "d",
        result: "½-½",
        locked: true,
      },
    ],
  },
  {
    number: 2,
    locked: true,
    completed: true,
    createdAt: "2026-01-02",
    pairings: [
      {
        id: "3",
        board: 1,
        whiteId: "a",
        blackId: "c",
        result: "½-½",
        locked: true,
      },
      {
        id: "4",
        board: 2,
        whiteId: "b",
        blackId: "d",
        result: "0-1",
        locked: true,
      },
    ],
  },
];

describe("standings", () => {
  it("calculates points, colors, outcomes and tie-breaks from round results", () => {
    const table = standings(roster, rounds);
    expect(table.map((entry) => entry.player.id)).toEqual(["a", "d", "c", "b"]);
    expect(table[0]).toMatchObject({
      points: 1.5,
      wins: 1,
      draws: 1,
      whiteGames: 2,
      rank: 1,
    });
    expect(table[1]).toMatchObject({
      points: 1.5,
      wins: 1,
      draws: 1,
      blackGames: 2,
      rank: 2,
    });
    expect(table.every((entry) => Number.isFinite(entry.buchholz))).toBe(true);
    expect(table.every((entry) => Number.isFinite(entry.sonneborn))).toBe(true);
  });
});
