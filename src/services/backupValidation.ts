/** Strict validation for untrusted JSON tournament backups. */
import type {
  AppState,
  GameResult,
  Pairing,
  Player,
  Round,
  Team,
  TeamScoring,
  Tournament,
  TournamentType,
} from "../models";

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

const TOURNAMENT_TYPES: readonly TournamentType[] = [
  "Swiss System",
  "Round Robin",
  "Round Robin manual crosstable",
  "Knockout",
  "Team Swiss",
  "Team Round Robin",
];
const TEAM_SCORING: readonly TeamScoring[] = [
  "2-1-0",
  "3-1-0",
  "board-points",
  "bughouse",
];
const RESULTS: readonly Exclude<GameResult, null>[] = [
  "1-0",
  "½-½",
  "0-1",
  "1F-0F",
  "0F-1F",
  "BYE",
];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_LOCAL_IMAGE =
  /^\.\/profiles\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:jpe?g|png|webp)$/i;
const SAFE_DATA_IMAGE =
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_AVATAR_LENGTH = 512 * 1024;

function invalid(): never {
  throw new Error("Invalid backup file");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max) invalid();
  if (required && !value.trim()) invalid();
  return value;
}

function id(value: unknown): string {
  const result = text(value, 128, true);
  if (
    !SAFE_ID.test(result) ||
    ["__proto__", "prototype", "constructor"].includes(result)
  )
    invalid();
  return result;
}

function numberIn(
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    invalid();
  return value;
}

function bool(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") invalid();
  return value;
}

function optionalText(value: unknown, max: number): string | undefined {
  return value === undefined ? undefined : text(value, max);
}

function calendarDate(value: unknown): string {
  const result = text(value ?? "", 10);
  if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result)) invalid();
  return result;
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid();
  return value as T;
}

/** Only app-generated local images are accepted; remote URLs and SVG are rejected. */
export function isSafeAvatarSource(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_AVATAR_LENGTH &&
    (SAFE_LOCAL_IMAGE.test(value) || SAFE_DATA_IMAGE.test(value))
  );
}

function numericMap(
  value: unknown,
  min: number,
  max: number,
): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  const output: Record<string, number> = Object.create(null) as Record<
    string,
    number
  >;
  if (Object.keys(source).length > 5000) invalid();
  for (const [key, entry] of Object.entries(source))
    output[id(key)] = numberIn(entry, min, max);
  return output;
}

function player(value: unknown): Player {
  const source = record(value);
  const avatar = source.avatar;
  if (avatar !== undefined && !isSafeAvatarSource(avatar)) invalid();
  return {
    id: id(source.id),
    name: text(source.name, 120, true),
    rating: numberIn(source.rating, 0, 3500, true),
    age: numberIn(source.age, 1, 120, true),
    club: text(source.club ?? "", 160),
    country: text(source.country ?? "", 32),
    fideId: text(source.fideId ?? "", 40),
    ageCategory: text(source.ageCategory ?? "", 80),
    ...(avatar ? { avatar } : {}),
    active: bool(source.active, true),
  };
}

function team(value: unknown, playerIds: Set<string>): Team {
  const source = record(value);
  if (!Array.isArray(source.playerIds) || source.playerIds.length > 100)
    invalid();
  const members = source.playerIds.map(id);
  if (new Set(members).size !== members.length) invalid();
  if (members.some((member) => !playerIds.has(member))) invalid();
  return {
    id: id(source.id),
    name: text(source.name, 120, true),
    playerIds: members,
    ...(source.emoji === undefined ? {} : { emoji: text(source.emoji, 32) }),
    active: bool(source.active, false),
  };
}

function pairing(
  value: unknown,
  playerIds: Set<string>,
  teamIds: Set<string>,
): Pairing {
  const source = record(value);
  const whiteId = id(source.whiteId);
  const blackId = source.blackId === null ? null : id(source.blackId);
  if (!playerIds.has(whiteId) || (blackId && !playerIds.has(blackId)))
    invalid();
  const result =
    source.result === null ? null : enumValue(source.result, RESULTS);
  const optionalId = (key: string): string | undefined => {
    if (source[key] === undefined) return undefined;
    return id(source[key]);
  };
  const teamMatchId = optionalId("teamMatchId");
  const whiteTeamId = optionalId("whiteTeamId");
  const blackTeamId =
    source.blackTeamId === null ? null : optionalId("blackTeamId");
  const bughouseWinnerTeamId = optionalId("bughouseWinnerTeamId");
  const bughouseDecidingGameId = optionalId("bughouseDecidingGameId");
  if (
    (whiteTeamId && !teamIds.has(whiteTeamId)) ||
    (blackTeamId && !teamIds.has(blackTeamId)) ||
    (bughouseWinnerTeamId && !teamIds.has(bughouseWinnerTeamId))
  )
    invalid();
  return {
    id: id(source.id),
    board: numberIn(source.board, 1, 10000, true),
    whiteId,
    blackId,
    result,
    locked: bool(source.locked),
    ...(teamMatchId ? { teamMatchId } : {}),
    ...(whiteTeamId ? { whiteTeamId } : {}),
    ...(blackTeamId !== undefined ? { blackTeamId } : {}),
    ...(bughouseWinnerTeamId ? { bughouseWinnerTeamId } : {}),
    ...(bughouseDecidingGameId ? { bughouseDecidingGameId } : {}),
  };
}

function round(
  value: unknown,
  playerIds: Set<string>,
  teamIds: Set<string>,
): Round {
  const source = record(value);
  if (!Array.isArray(source.pairings) || source.pairings.length > 10000)
    invalid();
  const pairings = source.pairings.map((entry) =>
    pairing(entry, playerIds, teamIds),
  );
  const pairingIds = new Set(pairings.map((entry) => entry.id));
  if (
    pairingIds.size !== pairings.length ||
    pairings.some(
      (entry) =>
        entry.bughouseDecidingGameId &&
        !pairingIds.has(entry.bughouseDecidingGameId),
    )
  )
    invalid();
  return {
    number: numberIn(source.number, 1, 1000, true),
    pairings,
    locked: bool(source.locked),
    completed: bool(source.completed),
    createdAt: text(source.createdAt, 64),
  };
}

function tournament(value: unknown): Tournament {
  const source = record(value);
  const rawType =
    source.type === "Manual Crosstable"
      ? "Round Robin manual crosstable"
      : source.type;
  const startingRatings = numericMap(source.startingRatings, 0, 10000);
  const ratingChanges = numericMap(source.ratingChanges, -10000, 10000);
  return {
    id: id(source.id),
    name: text(source.name, 160, true),
    venue: text(source.venue ?? "", 200),
    organizer: text(source.organizer ?? "", 160),
    date: calendarDate(source.date),
    timeControl: text(source.timeControl ?? "", 80),
    totalRounds: numberIn(source.totalRounds, 0, 1000, true),
    type: enumValue(rawType, TOURNAMENT_TYPES),
    ...(source.roundCountEntrants === undefined
      ? {}
      : {
          roundCountEntrants: numberIn(
            source.roundCountEntrants,
            0,
            10000,
            true,
          ),
        }),
    ...(source.swissRoundsManual === undefined
      ? {}
      : { swissRoundsManual: bool(source.swissRoundsManual) }),
    ...(source.teamSize === undefined
      ? {}
      : { teamSize: numberIn(source.teamSize, 1, 100, true) }),
    ...(source.teamScoring === undefined
      ? {}
      : { teamScoring: enumValue(source.teamScoring, TEAM_SCORING) }),
    ...(source.rated === undefined ? {} : { rated: bool(source.rated) }),
    ...(source.ratingsApplied === undefined
      ? {}
      : { ratingsApplied: bool(source.ratingsApplied) }),
    ...(startingRatings ? { startingRatings } : {}),
    ...(ratingChanges ? { ratingChanges } : {}),
    createdAt: text(source.createdAt, 64),
    finished: bool(source.finished),
  };
}

/** Parse and normalize a backup without trusting its TypeScript-shaped JSON. */
export function validateBackup(value: unknown): AppState {
  const source = record(value);
  if (!Array.isArray(source.players) || source.players.length > 5000) invalid();
  const players = source.players.map(player);
  const playerIds = new Set(players.map((entry) => entry.id));
  if (playerIds.size !== players.length) invalid();

  if (source.teams !== undefined && !Array.isArray(source.teams)) invalid();
  const rawTeams = (source.teams as unknown[] | undefined) ?? [];
  if (rawTeams.length > 5000) invalid();
  const teams = rawTeams.map((entry) => team(entry, playerIds));
  const teamIds = new Set(teams.map((entry) => entry.id));
  if (teamIds.size !== teams.length) invalid();

  if (!Array.isArray(source.rounds) || source.rounds.length > 1000) invalid();
  const rounds = source.rounds.map((entry) => round(entry, playerIds, teamIds));
  if (new Set(rounds.map((entry) => entry.number)).size !== rounds.length)
    invalid();

  return {
    tournament: tournament(source.tournament),
    players,
    ...(source.teams === undefined ? {} : { teams }),
    rounds,
    view: optionalText(source.view, 40) ?? "dashboard",
  };
}
