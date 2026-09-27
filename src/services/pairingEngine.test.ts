import { describe, expect, it } from "vitest";
import type { Player, Round } from "../models";
import {
  generateKnockout,
  generateRoundRobin,
  generateSwiss,
  knockoutRoundCount,
} from "./pairingEngine";

function players(count: number): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    rating: 2000 - index * 50,
    age: 20,
    club: "",
    country: "PHI",
    fideId: "",
    ageCategory: "Open",
    active: true,
  }));
}

describe("Swiss pairing", () => {
  it("pairs every active player once and awards one odd-player bye", () => {
    const pairings = generateSwiss(players(5), []);
    const ids = pairings.flatMap((game) =>
      [game.whiteId, game.blackId].filter(Boolean),
    );
    expect(new Set(ids).size).toBe(5);
    expect(pairings.filter((game) => game.blackId === null)).toHaveLength(1);
    expect(pairings.every((game) => game.whiteId !== game.blackId)).toBe(true);
  });

  it("avoids repeat opponents and gives the next eligible player a bye", () => {
    const roster = players(5);
    const firstPairings = generateSwiss(roster, []);
    const first: Round = {
      number: 1,
      pairings: firstPairings.map((game) => ({
        ...game,
        result: game.blackId ? "½-½" : "BYE",
      })),
      locked: true,
      completed: true,
      createdAt: new Date().toISOString(),
    };
    const second = generateSwiss(roster, [first]);
    const firstOpponents = new Set(
      first.pairings
        .filter((game) => game.blackId)
        .map((game) => [game.whiteId, game.blackId].sort().join("-")),
    );
    const repeated = second
      .filter((game) => game.blackId)
      .filter((game) =>
        firstOpponents.has([game.whiteId, game.blackId].sort().join("-")),
      );
    expect(repeated).toHaveLength(0);
    expect(second.find((game) => !game.blackId)?.whiteId).not.toBe(
      first.pairings.find((game) => !game.blackId)?.whiteId,
    );
  });
});

describe("round-robin pairing", () => {
  it("schedules every pair exactly once over n-1 rounds", () => {
    const roster = players(4);
    const rounds: Round[] = [];
    for (let index = 0; index < 3; index++) {
      const pairings = generateRoundRobin(roster, rounds);
      rounds.push({
        number: index + 1,
        pairings,
        locked: true,
        completed: true,
        createdAt: new Date().toISOString(),
      });
    }
    const pairs = rounds.flatMap((round) =>
      round.pairings.map((game) =>
        [game.whiteId, game.blackId].sort().join("-"),
      ),
    );
    expect(new Set(pairs).size).toBe(6);
  });
});

describe("knockout pairing", () => {
  it("seeds a power-of-two bracket, gives top seeds byes, and advances winners", () => {
    const roster = players(6);
    expect(knockoutRoundCount(roster.length)).toBe(3);

    const firstPairings = generateKnockout(roster, []);
    expect(firstPairings).toHaveLength(4);
    expect(
      firstPairings.filter((game) => !game.blackId).map((game) => game.whiteId),
    ).toEqual(["p1", "p2"]);
    expect(
      firstPairings
        .filter((game) => game.blackId)
        .map((game) => [game.whiteId, game.blackId]),
    ).toEqual([
      ["p4", "p5"],
      ["p3", "p6"],
    ]);

    const first: Round = {
      number: 1,
      pairings: firstPairings.map((game) => ({
        ...game,
        result: game.blackId ? ("1-0" as const) : ("BYE" as const),
      })),
      locked: true,
      completed: true,
      createdAt: new Date().toISOString(),
    };
    const semifinalPairings = generateKnockout(roster, [first]);
    expect(semifinalPairings).toHaveLength(2);
    expect(
      semifinalPairings.map((game) => new Set([game.whiteId, game.blackId])),
    ).toEqual([new Set(["p1", "p4"]), new Set(["p2", "p3"])]);

    const semifinal: Round = {
      number: 2,
      pairings: semifinalPairings.map((game) => ({
        ...game,
        result: "1-0" as const,
      })),
      locked: true,
      completed: true,
      createdAt: new Date().toISOString(),
    };
    expect(generateKnockout(roster, [first, semifinal])).toHaveLength(1);
  });

  it("rejects a drawn knockout game when advancing the bracket", () => {
    const roster = players(2);
    const drawn: Round = {
      number: 1,
      pairings: generateKnockout(roster, []).map((game) => ({
        ...game,
        result: "½-½" as const,
      })),
      locked: true,
      completed: true,
      createdAt: new Date().toISOString(),
    };
    expect(() => generateKnockout(roster, [drawn])).toThrow(/decisive/);
  });
});
