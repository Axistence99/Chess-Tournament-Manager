/** Unit tests for team pairing formats and selectable scoring systems. */
import { describe, expect, it } from "vitest";
import type { Player, Round, Team, Tournament } from "../models";
import { generateTeamRound, teamStandings } from "./teamTournament";

const players: Player[] = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  name: `Player ${index + 1}`,
  rating: 2000 - index * 25,
  age: 20,
  club: "",
  country: "PHI",
  fideId: "",
  ageCategory: "Open",
  active: true,
}));
const teams: Team[] = Array.from({ length: 4 }, (_, index) => ({
  id: `t${index + 1}`,
  name: `Team ${index + 1}`,
  playerIds: [`p${index * 2 + 1}`, `p${index * 2 + 2}`],
  active: true,
}));
const tournament = (type: Tournament["type"]): Tournament => ({
  id: "event",
  name: "Team Event",
  venue: "",
  organizer: "",
  date: "2026-09-30",
  timeControl: "15+10",
  totalRounds: 3,
  type,
  teamSize: 2,
  teamScoring: "2-1-0",
  createdAt: new Date().toISOString(),
  finished: false,
});

describe("team round robin", () => {
  it("pairs every team exactly once without self-matches", () => {
    const rounds: Round[] = [];
    for (let index = 0; index < 3; index++) {
      const pairings = generateTeamRound(
        tournament("Team Round Robin"),
        players,
        teams,
        rounds,
      );
      rounds.push({
        number: index + 1,
        pairings: pairings.map((game) => ({ ...game, result: "½-½" })),
        locked: true,
        completed: true,
        createdAt: new Date().toISOString(),
      });
    }
    const matches = new Map<string, Set<string>>();
    for (const game of rounds.flatMap((round) => round.pairings)) {
      if (!game.teamMatchId) continue;
      const ids = matches.get(game.teamMatchId) || new Set<string>();
      if (game.whiteTeamId) ids.add(game.whiteTeamId);
      if (game.blackTeamId) ids.add(game.blackTeamId);
      matches.set(game.teamMatchId, ids);
    }
    expect(matches.size).toBe(6);
    expect([...matches.values()].every((ids) => ids.size === 2)).toBe(true);
    expect(
      new Set([...matches.values()].map((ids) => [...ids].sort().join("-")))
        .size,
    ).toBe(6);
  });

  it("gives every team one bye in an odd field", () => {
    const oddTeams = teams.slice(0, 3);
    const rounds: Round[] = [];
    for (let index = 0; index < 3; index++) {
      const pairings = generateTeamRound(
        { ...tournament("Team Round Robin"), totalRounds: 3 },
        players,
        oddTeams,
        rounds,
      );
      rounds.push({
        number: index + 1,
        pairings,
        locked: true,
        completed: false,
        createdAt: new Date().toISOString(),
      });
    }
    const byeTeams = rounds.map(
      (round) =>
        round.pairings.find((game) => game.result === "BYE" && game.whiteTeamId)
          ?.whiteTeamId,
    );
    expect(new Set(byeTeams).size).toBe(3);
  });
});

describe("team swiss", () => {
  it("avoids repeat opponents when another pairing is available", () => {
    const first = generateTeamRound(
      tournament("Team Swiss"),
      players,
      teams,
      [],
    );
    const firstPairs = new Set(
      [...new Set(first.map((game) => game.teamMatchId))].map((matchId) => {
        const game = first.find((entry) => entry.teamMatchId === matchId)!;
        return [game.whiteTeamId, game.blackTeamId].sort().join("-");
      }),
    );
    const round: Round = {
      number: 1,
      pairings: first.map((game) => ({ ...game, result: "½-½" })),
      locked: true,
      completed: true,
      createdAt: new Date().toISOString(),
    };
    const second = generateTeamRound(tournament("Team Swiss"), players, teams, [
      round,
    ]);
    const secondPairs = [
      ...new Set(second.map((game) => game.teamMatchId)),
    ].map((matchId) => {
      const game = second.find((entry) => entry.teamMatchId === matchId)!;
      return [game.whiteTeamId, game.blackTeamId].sort().join("-");
    });
    expect(secondPairs.every((pair) => !firstPairs.has(pair))).toBe(true);
  });
});

describe("team scoring", () => {
  const completedRound = (): Round => ({
    number: 1,
    pairings: generateTeamRound(
      tournament("Team Swiss"),
      players,
      teams,
      [],
    ).map((game) => ({
      ...game,
      result:
        (game.whiteTeamId || "") < (game.blackTeamId || "") ? "1-0" : "0-1",
    })),
    locked: true,
    completed: true,
    createdAt: new Date().toISOString(),
  });

  it("supports 2-1-0 and 3-1-0 match points", () => {
    const round = completedRound();
    expect(teamStandings(teams, [round], "2-1-0")[0].matchPoints).toBe(2);
    expect(teamStandings(teams, [round], "3-1-0")[0].matchPoints).toBe(3);
  });

  it("supports board-points-only ranking", () => {
    const standings = teamStandings(teams, [completedRound()], "board-points");
    expect(standings[0].boardPoints).toBeGreaterThan(0);
    expect(standings.every((entry) => entry.matchPoints === 0)).toBe(true);
  });
});
