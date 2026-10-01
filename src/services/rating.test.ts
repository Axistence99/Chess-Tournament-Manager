import { describe, expect, it } from "vitest";
import type { Player, Round } from "../models";
import { calculateRatingChanges, expectedScore } from "./rating";

const player = (id: string, rating: number): Player => ({
  id,
  name: id,
  rating,
  age: 20,
  club: "",
  country: "",
  fideId: "",
  ageCategory: "Open",
  active: true,
});

const round = (result: Round["pairings"][number]["result"]): Round => ({
  number: 1,
  locked: true,
  completed: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  pairings: [
    {
      id: "game",
      board: 1,
      whiteId: "white",
      blackId: "black",
      result,
      locked: true,
    },
  ],
});

describe("Elo rating calculations", () => {
  it("uses the standard expected-score formula", () => {
    expect(expectedScore(1600, 1600)).toBeCloseTo(0.5);
    expect(expectedScore(1800, 1600)).toBeCloseTo(0.7597, 3);
  });

  it("adds to a winner and subtracts the same amount from a loser", () => {
    const changes = calculateRatingChanges(
      [player("white", 1600), player("black", 1600)],
      [round("1-0")],
    );
    expect(changes).toEqual({ white: 10, black: -10 });
  });

  it("keeps game changes zero-sum and excludes byes, forfeits, and unrated games", () => {
    const rated = calculateRatingChanges(
      [player("white", 1800), player("black", 1600)],
      [round("0-1")],
    );
    expect(rated.white).toBeLessThan(0);
    expect(rated.black).toBeGreaterThan(0);
    expect(rated.white + rated.black).toBe(0);

    expect(
      calculateRatingChanges(
        [player("white", 1600), player("black", 1600)],
        [round("1F-0F")],
      ),
    ).toEqual({ white: 0, black: 0 });
    expect(
      calculateRatingChanges(
        [player("white", 0), player("black", 1600)],
        [round("1-0")],
      ),
    ).toEqual({ white: 0, black: 0 });
  });
});
