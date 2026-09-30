/** Team pairing and standings logic shared by Team Swiss and Team Round Robin. */
import type {
  Pairing,
  Player,
  Round,
  Team,
  TeamScoring,
  Tournament,
} from "../models";
import { roundRobinRoundCount } from "./pairingEngine";

export interface TeamStanding {
  team: Team;
  matchPoints: number;
  boardPoints: number;
  wins: number;
  draws: number;
  losses: number;
  buchholz: number;
  rank: number;
}

const uid = () => crypto.randomUUID();

function scoringWin(system: TeamScoring): number {
  return system === "3-1-0" ? 3 : 2;
}

/** Group all individual boards belonging to the same team match. */
function teamMatches(rounds: Round[]): Pairing[][] {
  const matches = new Map<string, Pairing[]>();
  for (const game of rounds.flatMap((round) => round.pairings)) {
    if (!game.teamMatchId) continue;
    const boards = matches.get(game.teamMatchId) || [];
    boards.push(game);
    matches.set(game.teamMatchId, boards);
  }
  return [...matches.values()];
}

function boardScore(game: Pairing, teamId: string): number {
  if (game.result === "BYE") return 1;
  if (!game.result) return 0;
  if (game.result === "½-½") return 0.5;
  const isWhite = game.whiteTeamId === teamId;
  const won =
    (isWhite && (game.result === "1-0" || game.result === "1F-0F")) ||
    (!isWhite && (game.result === "0-1" || game.result === "0F-1F"));
  return won ? 1 : 0;
}

/** Derive team match points, board points, and Buchholz from board results. */
export function teamStandings(
  teams: Team[],
  rounds: Round[],
  scoring: TeamScoring,
): TeamStanding[] {
  const active = teams.filter((team) => team.active);
  const table = new Map<string, TeamStanding>(
    active.map((team) => [
      team.id,
      {
        team,
        matchPoints: 0,
        boardPoints: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        buchholz: 0,
        rank: 0,
      },
    ]),
  );
  const opponents = new Map<string, string[]>(
    active.map((team) => [team.id, []]),
  );

  for (const boards of teamMatches(rounds)) {
    if (!boards.every((game) => game.result !== null)) continue;
    const teamIds = new Set<string>();
    for (const board of boards) {
      if (board.whiteTeamId) teamIds.add(board.whiteTeamId);
      if (board.blackTeamId) teamIds.add(board.blackTeamId);
    }
    const [firstId, secondId] = [...teamIds];
    const first = table.get(firstId);
    if (!first) continue;
    const firstBoards = boards.reduce(
      (sum, game) => sum + boardScore(game, firstId),
      0,
    );
    first.boardPoints += firstBoards;

    // A team bye is represented by one BYE board for every roster member.
    if (!secondId) {
      first.wins++;
      if (scoring !== "board-points") first.matchPoints += scoringWin(scoring);
      continue;
    }
    const second = table.get(secondId);
    if (!second) continue;
    const secondBoards = boards.reduce(
      (sum, game) => sum + boardScore(game, secondId),
      0,
    );
    second.boardPoints += secondBoards;
    opponents.get(firstId)?.push(secondId);
    opponents.get(secondId)?.push(firstId);

    if (firstBoards > secondBoards) {
      first.wins++;
      second.losses++;
      if (scoring !== "board-points") first.matchPoints += scoringWin(scoring);
    } else if (secondBoards > firstBoards) {
      second.wins++;
      first.losses++;
      if (scoring !== "board-points") second.matchPoints += scoringWin(scoring);
    } else {
      first.draws++;
      second.draws++;
      if (scoring !== "board-points") {
        first.matchPoints++;
        second.matchPoints++;
      }
    }
  }

  for (const [id, entry] of table)
    entry.buchholz = (opponents.get(id) || []).reduce(
      (sum, opponentId) =>
        sum +
        (scoring === "board-points"
          ? table.get(opponentId)?.boardPoints || 0
          : table.get(opponentId)?.matchPoints || 0),
      0,
    );

  const sorted = [...table.values()].sort((a, b) => {
    const primaryA = scoring === "board-points" ? a.boardPoints : a.matchPoints;
    const primaryB = scoring === "board-points" ? b.boardPoints : b.matchPoints;
    return (
      primaryB - primaryA ||
      b.boardPoints - a.boardPoints ||
      b.buchholz - a.buchholz ||
      a.team.name.localeCompare(b.team.name)
    );
  });
  sorted.forEach((entry, index) => (entry.rank = index + 1));
  return sorted;
}

function boardPairings(
  first: Team,
  second: Team | null,
  roundNumber: number,
  matchIndex: number,
): Pairing[] {
  const matchId = uid();
  if (!second)
    return first.playerIds.map((playerId, boardIndex) => ({
      id: uid(),
      board: matchIndex * first.playerIds.length + boardIndex + 1,
      whiteId: playerId,
      blackId: null,
      result: "BYE",
      locked: false,
      teamMatchId: matchId,
      whiteTeamId: first.id,
      blackTeamId: null,
    }));

  return first.playerIds.map((firstPlayerId, boardIndex) => {
    const secondPlayerId = second.playerIds[boardIndex];
    const firstWhite = (roundNumber + matchIndex + boardIndex) % 2 === 0;
    return {
      id: uid(),
      board: matchIndex * first.playerIds.length + boardIndex + 1,
      whiteId: firstWhite ? firstPlayerId : secondPlayerId,
      blackId: firstWhite ? secondPlayerId : firstPlayerId,
      result: null,
      locked: false,
      teamMatchId: matchId,
      whiteTeamId: firstWhite ? first.id : second.id,
      blackTeamId: firstWhite ? second.id : first.id,
    };
  });
}

function roundRobinTeamPairs(teams: Team[], roundIndex: number) {
  const field: Array<Team | null> = [...teams];
  if (field.length % 2) field.push(null);
  const fixed = field[0];
  const rotating = field.slice(1);
  for (let turn = 0; turn < roundIndex; turn++)
    rotating.unshift(rotating.pop()!);
  const arranged = [fixed, ...rotating];
  return Array.from(
    { length: arranged.length / 2 },
    (_, index) =>
      [arranged[index], arranged[arranged.length - 1 - index]] as const,
  );
}

/** Create one complete team round with one individual game per playing board. */
export function generateTeamRound(
  tournament: Tournament,
  players: Player[],
  teams: Team[],
  rounds: Round[],
): Pairing[] {
  const size = tournament.teamSize || 1;
  const active = teams.filter(
    (team) => team.active && team.playerIds.length === size,
  );
  if (active.length < 2) return [];

  let pairs: ReadonlyArray<readonly [Team | null, Team | null]>;
  if (tournament.type === "Team Round Robin") {
    pairs = roundRobinTeamPairs(active, rounds.length);
  } else {
    const scoring = tournament.teamScoring || "2-1-0";
    const ranked = teamStandings(active, rounds, scoring).map(
      (entry) => entry.team,
    );
    const previous = new Set(
      teamMatches(rounds).flatMap((boards) => {
        const ids = new Set(
          boards.flatMap((game) =>
            [game.whiteTeamId, game.blackTeamId].filter(Boolean),
          ),
        );
        return ids.size === 2 ? [[...ids].sort().join("-")] : [];
      }),
    );
    const pool = [...ranked];
    const swissPairs: Array<[Team, Team | null]> = [];
    if (pool.length % 2) swissPairs.push([pool.pop()!, null]);
    while (pool.length) {
      const first = pool.shift()!;
      let opponentIndex = pool.findIndex(
        (candidate) => !previous.has([first.id, candidate.id].sort().join("-")),
      );
      if (opponentIndex < 0) opponentIndex = 0;
      swissPairs.push([first, pool.splice(opponentIndex, 1)[0]]);
    }
    pairs = swissPairs;
  }

  const games: Pairing[] = [];
  pairs.forEach(([first, second], matchIndex) => {
    const real = first || second;
    if (!real) return;
    games.push(
      ...boardPairings(
        real,
        first && second ? second : null,
        rounds.length + 1,
        matchIndex,
      ),
    );
  });
  games.forEach((game, index) => (game.board = index + 1));
  return games;
}

export function teamRoundCount(type: Tournament["type"], teamCount: number) {
  return type === "Team Round Robin" ? roundRobinRoundCount(teamCount) : null;
}
