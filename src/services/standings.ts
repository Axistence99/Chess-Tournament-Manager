/** Derive live rankings and tie-break values from players and round results. */
import type { Player, PlayerStats, Round } from "../models";
/**
 * Rebuild standings from immutable round results.
 *
 * Tie-break order:
 * 1. Match points
 * 2. Buchholz (sum of opponents' scores)
 * 3. Sonneborn-Berger
 * 4. Wins
 * 5. Rating
 *
 * Values are derived instead of persisted so undoing or correcting a result can
 * never leave stale tie-break data behind.
 */
export function standings(players: Player[], rounds: Round[]): PlayerStats[] {
  const base = new Map<string, PlayerStats>(
    players.map((p) => [
      p.id,
      {
        player: p,
        points: 0,
        buchholz: 0,
        buchholzCut: 0,
        sonneborn: 0,
        wins: 0,
        whiteGames: 0,
        blackGames: 0,
        losses: 0,
        draws: 0,
        bye: false,
        opponents: [],
        rank: 0,
      },
    ]),
  );
  for (const r of rounds)
    for (const g of r.pairings) {
      const w = base.get(g.whiteId);
      if (!w) continue;
      if (!g.blackId) {
        w.points++;
        w.wins++;
        w.bye = true;
        continue;
      }
      const b = base.get(g.blackId);
      if (!b) continue;
      w.whiteGames++;
      b.blackGames++;
      w.opponents.push(b.player.id);
      b.opponents.push(w.player.id);
      if (g.result === "1-0" || g.result === "1F-0F") {
        w.points++;
        w.wins++;
        b.losses++;
      } else if (g.result === "0-1" || g.result === "0F-1F") {
        b.points++;
        b.wins++;
        w.losses++;
      } else if (g.result === "½-½") {
        w.points += 0.5;
        b.points += 0.5;
        w.draws++;
        b.draws++;
      }
    }
  for (const s of base.values()) {
    const scores = s.opponents.map((id) => base.get(id)?.points || 0);
    s.buchholz = scores.reduce((a, b) => a + b, 0);
    s.buchholzCut = s.buchholz - (scores.length ? Math.min(...scores) : 0);
    s.sonneborn = 0;
    for (const r of rounds)
      for (const g of r.pairings) {
        if (!g.blackId) continue;
        if (g.whiteId === s.player.id)
          s.sonneborn +=
            g.result === "1-0" || g.result === "1F-0F"
              ? base.get(g.blackId)!.points
              : g.result === "½-½"
                ? base.get(g.blackId)!.points / 2
                : 0;
        if (g.blackId === s.player.id)
          s.sonneborn +=
            g.result === "0-1" || g.result === "0F-1F"
              ? base.get(g.whiteId)!.points
              : g.result === "½-½"
                ? base.get(g.whiteId)!.points / 2
                : 0;
      }
  }
  const sorted = [...base.values()]
    .filter((s) => s.player.active)
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.buchholz - a.buchholz ||
        b.sonneborn - a.sonneborn ||
        b.wins - a.wins ||
        b.player.rating - a.player.rating,
    );
  sorted.forEach((s, i) => (s.rank = i + 1));
  return sorted;
}
