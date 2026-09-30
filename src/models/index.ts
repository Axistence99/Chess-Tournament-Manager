/** Shared domain types used by pairing, standings, storage, exports, and UI. */
export type TournamentType =
  | "Swiss System"
  | "Round Robin"
  | "Knockout"
  | "Team Swiss"
  | "Team Round Robin";
export type TeamScoring = "2-1-0" | "3-1-0" | "board-points";
export type GameResult =
  "1-0" | "½-½" | "0-1" | "1F-0F" | "0F-1F" | "BYE" | null;
export interface Tournament {
  id: string;
  name: string;
  venue: string;
  organizer: string;
  date: string;
  timeControl: string;
  totalRounds: number;
  type: TournamentType;
  /** Entrant count used for the latest Swiss round recommendation. */
  roundCountEntrants?: number;
  /** Preserve an organizer-entered Swiss schedule across roster changes. */
  swissRoundsManual?: boolean;
  /** Playing boards per team match; used only by team formats. */
  teamSize?: number;
  /** Configurable team standings system selected during tournament creation. */
  teamScoring?: TeamScoring;
  createdAt: string;
  finished: boolean;
}
export interface Player {
  id: string;
  name: string;
  rating: number;
  age: number;
  club: string;
  country: string;
  fideId: string;
  /** Derived from age when a player is created or edited. */
  ageCategory: string;
  /** Compressed data URL stored locally; omitted when initials are used. */
  avatar?: string;
  active: boolean;
}
export interface Team {
  id: string;
  name: string;
  playerIds: string[];
  /** Inactive teams remain editable but are excluded from pairings. */
  active: boolean;
}
export interface Pairing {
  id: string;
  board: number;
  whiteId: string;
  blackId: string | null;
  result: GameResult;
  locked: boolean;
  /** Team metadata groups individual boards into one team match. */
  teamMatchId?: string;
  whiteTeamId?: string;
  blackTeamId?: string | null;
}
export interface Round {
  number: number;
  pairings: Pairing[];
  locked: boolean;
  completed: boolean;
  createdAt: string;
}
export interface AppState {
  tournament: Tournament;
  players: Player[];
  /** Team definitions are present only for team tournaments and legacy-safe. */
  teams?: Team[];
  rounds: Round[];
  view: string;
}
export interface PlayerStats {
  player: Player;
  points: number;
  buchholz: number;
  buchholzCut: number;
  sonneborn: number;
  wins: number;
  whiteGames: number;
  blackGames: number;
  losses: number;
  draws: number;
  bye: boolean;
  opponents: string[];
  rank: number;
}
