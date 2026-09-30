/** Unit tests for supported pairing formats and tournament edge cases. */
import { describe, expect, it } from "vitest";
import type { Player, Round } from "../models";
import {
  generateKnockout,
  generateRoundRobin,
  generateSwiss,
  knockoutRoundCount,
  recommendedSwissRoundCount,
  roundRobinRoundCount,
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
  it("recommends compact rounds from the active field size", () => {
    expect(recommendedSwissRoundCount(0)).toBe(0);
    expect(recommendedSwissRoundCount(2)).toBe(1);
    expect(recommendedSwissRoundCount(3)).toBe(2);
    expect(recommendedSwissRoundCount(4)).toBe(2);
    expect(recommendedSwissRoundCount(8)).toBe(3);
    expect(recommendedSwissRoundCount(9)).toBe(4);
  });

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
  it("derives the round count from even and odd field sizes", () => {
    expect(roundRobinRoundCount(0)).toBe(0);
    expect(roundRobinRoundCount(1)).toBe(0);
    expect(roundRobinRoundCount(2)).toBe(1);
    expect(roundRobinRoundCount(4)).toBe(3);
    expect(roundRobinRoundCount(5)).toBe(5);
  });

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
    expect(
      pairs.every((pair) => pair.split("-")[0] !== pair.split("-")[1]),
    ).toBe(true);
  });

  it("gives an odd field one bye per round without self-pairings", () => {
    const roster = players(5);
    const rounds: Round[] = [];
    for (let index = 0; index < roundRobinRoundCount(roster.length); index++) {
      rounds.push({
        number: index + 1,
        pairings: generateRoundRobin(roster, rounds),
        locked: true,
        completed: true,
        createdAt: new Date().toISOString(),
      });
    }
    const games = rounds.flatMap((round) => round.pairings);
    const pairs = games
      .filter((game) => game.blackId)
      .map((game) => [game.whiteId, game.blackId].sort().join("-"));
    expect(rounds).toHaveLength(5);
    expect(new Set(pairs).size).toBe(10);
    expect(games.filter((game) => !game.blackId)).toHaveLength(5);
    expect(games.every((game) => game.whiteId !== game.blackId)).toBe(true);
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
