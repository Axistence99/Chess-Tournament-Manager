/** Standard zero-sum Elo calculations for rated tournament games. */
import type { Player, Round } from "../models";

export const DEFAULT_K_FACTOR = 20;

/** Expected score using the conventional 400-point Elo scale. */
export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/**
 * Calculate cumulative tournament rating changes without mutating players.
 *
 * Each game's rounded change is zero-sum. Byes, forfeits, pending games, and
 * games involving an unrated (zero-rated) player are intentionally excluded.
 */
export function calculateRatingChanges(
  players: Player[],
  rounds: Round[],
  kFactor = DEFAULT_K_FACTOR,
  startingRatings?: Record<string, number>,
): Record<string, number> {
  const ratings = new Map(
    players.map((player) => [
      player.id,
      startingRatings?.[player.id] ?? player.rating,
    ]),
  );
  const changes = Object.fromEntries(players.map((player) => [player.id, 0]));

  for (const game of rounds.flatMap((round) => round.pairings)) {
    if (!game.blackId || !["1-0", "½-½", "0-1"].includes(game.result || ""))
      continue;
    const whiteRating = ratings.get(game.whiteId) || 0;
    const blackRating = ratings.get(game.blackId) || 0;
    if (whiteRating <= 0 || blackRating <= 0) continue;

    const whiteScore =
      game.result === "1-0" ? 1 : game.result === "½-½" ? 0.5 : 0;
    let whiteChange = Math.round(
      kFactor * (whiteScore - expectedScore(whiteRating, blackRating)),
    );
    // A decisive rated game should always visibly reward the winner and deduct
    // from the loser, even for an extreme rating mismatch that rounds to zero.
    if (game.result !== "½-½" && whiteChange === 0)
      whiteChange = game.result === "1-0" ? 1 : -1;
    changes[game.whiteId] = (changes[game.whiteId] || 0) + whiteChange;
    changes[game.blackId] = (changes[game.blackId] || 0) - whiteChange;
  }

  return changes;
}
