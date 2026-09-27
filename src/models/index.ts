export type TournamentType =
  "Swiss System" | "Round Robin" | "Knockout" | "Team";
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
export interface Pairing {
  id: string;
  board: number;
  whiteId: string;
  blackId: string | null;
  result: GameResult;
  locked: boolean;
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
