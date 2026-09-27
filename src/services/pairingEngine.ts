/** Pairing algorithms for Swiss, Round Robin, and Knockout tournaments. */
import type { Pairing, Player, Round } from "../models";
const uid = () => crypto.randomUUID();
type Meta = {
  score: number;
  opponents: Set<string>;
  balance: number;
  bye: boolean;
};
function metadata(players: Player[], rounds: Round[]) {
  const m = new Map<string, Meta>(
    players.map((p) => [
      p.id,
      { score: 0, opponents: new Set(), balance: 0, bye: false },
    ]),
  );
  for (const r of rounds)
    for (const g of r.pairings) {
      const w = m.get(g.whiteId);
      if (!w) continue;
      if (!g.blackId) {
        w.score += 1;
        w.bye = true;
        continue;
      }
      const b = m.get(g.blackId);
      if (!b) continue;
      w.opponents.add(g.blackId);
      b.opponents.add(g.whiteId);
      w.balance++;
      b.balance--;
      if (g.result === "1-0" || g.result === "1F-0F") w.score++;
      else if (g.result === "0-1" || g.result === "0F-1F") b.score++;
      else if (g.result === "½-½") {
        w.score += 0.5;
        b.score += 0.5;
      }
    }
  return m;
}
/** Score-group greedy Swiss pairing with bounded backtracking; repeat and color penalties are minimized. */
export function generateRoundRobin(
  players: Player[],
  rounds: Round[],
): Pairing[] {
  const active = players
    .filter((p) => p.active)
    .sort((a, b) => b.rating - a.rating);
  const ghost = active.length % 2 ? null : undefined;
  if (ghost === null)
    active.push({
      id: "BYE",
      name: "Bye",
      rating: 0,
      age: 0,
      club: "",
      country: "",
      fideId: "",
      ageCategory: "",
      active: false,
    });
  const n = active.length,
    cycle = Math.floor(rounds.length / (n - 1)),
    index = rounds.length % (n - 1),
    rot = [
      active[0],
      ...active.slice(1 + index),
      ...active.slice(1, 1 + index),
    ];
  const out: Pairing[] = [];
  for (let i = 0; i < n / 2; i++) {
    const a = rot[i],
      b = rot[n - 1 - i];
    if (a.id === "BYE" || b.id === "BYE") {
      const real = a.id === "BYE" ? b : a;
      out.push({
        id: uid(),
        board: 0,
        whiteId: real.id,
        blackId: null,
        result: "BYE",
        locked: false,
      });
      continue;
    }
    const flip = (index + i + cycle) % 2 === 1;
    out.push({
      id: uid(),
      board: 0,
      whiteId: flip ? b.id : a.id,
      blackId: flip ? a.id : b.id,
      result: null,
      locked: false,
    });
  }
  out.sort((a, b) => Number(!a.blackId) - Number(!b.blackId));
  out.forEach((g, i) => (g.board = i + 1));
  return out;
}
/**
 * Build a seeded single-elimination bracket.
 *
 * Round one expands the field to the next power of two and awards byes to the
 * highest-rated seeds. Later rounds preserve bracket order and advance only
 * decisive winners from the preceding round.
 */
export function generateKnockout(
  players: Player[],
  rounds: Round[],
): Pairing[] {
  const pairing = (
    whiteId: string,
    blackId: string | null,
    board: number,
  ): Pairing => ({
    id: uid(),
    board,
    whiteId,
    blackId,
    result: blackId ? null : "BYE",
    locked: false,
  });

  if (!rounds.length) {
    const seeds = players
      .filter((player) => player.active)
      .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
    const bracketSize = 2 ** Math.ceil(Math.log2(seeds.length));
    // Recursive seed positions keep seeds 1 and 2 in opposite halves, then
    // distribute the remaining seeds so the strongest can only meet late.
    let positions = [1, 2];
    for (let size = 4; size <= bracketSize; size *= 2)
      positions = positions.flatMap((seed) => [seed, size + 1 - seed]);
    const out: Pairing[] = [];
    for (let index = 0; index < positions.length; index += 2) {
      const first = seeds[positions[index] - 1];
      const second = seeds[positions[index + 1] - 1];
      const real = first || second;
      if (real)
        out.push(
          pairing(real.id, first && second ? second.id : null, out.length + 1),
        );
    }
    return out;
  }

  const winners = rounds.at(-1)!.pairings.map((game) => {
    if (!game.blackId || game.result === "BYE") return game.whiteId;
    if (game.result === "1-0" || game.result === "1F-0F") return game.whiteId;
    if (game.result === "0-1" || game.result === "0F-1F") return game.blackId;
    throw new Error("Knockout games require a decisive result.");
  });
  const out: Pairing[] = [];
  for (let index = 0; index < winners.length; index += 2) {
    const first = winners[index];
    const second = winners[index + 1] || null;
    const flip = rounds.length % 2 === 1;
    out.push(
      pairing(
        flip && second ? second : first,
        flip && second ? first : second,
        out.length + 1,
      ),
    );
  }
  return out;
}

export function knockoutRoundCount(playerCount: number): number {
  return playerCount < 2 ? 0 : Math.ceil(Math.log2(playerCount));
}

/**
 * Pair adjacent score groups while minimizing repeat-opponent and color costs.
 * The lowest eligible player receives a bye only once when possible.
 */
export function generateSwiss(players: Player[], rounds: Round[]): Pairing[] {
  const active = players.filter((p) => p.active);
  const m = metadata(active, rounds);
  active.sort(
    (a, b) => m.get(b.id)!.score - m.get(a.id)!.score || b.rating - a.rating,
  );
  const out: Pairing[] = [];
  if (active.length % 2) {
    const eligible = [...active].reverse().filter((p) => !m.get(p.id)!.bye);
    const bye = eligible[0] || active.at(-1)!;
    active.splice(active.indexOf(bye), 1);
    out.push({
      id: uid(),
      board: 0,
      whiteId: bye.id,
      blackId: null,
      result: "BYE",
      locked: false,
    });
  }
  let board = 1;
  while (active.length) {
    const a = active.shift()!;
    let best = 0,
      bestCost = Infinity;
    for (let i = 0; i < active.length; i++) {
      const b = active[i],
        ma = m.get(a.id)!,
        mb = m.get(b.id)!;
      const cost =
        Math.abs(ma.score - mb.score) * 20 +
        (ma.opponents.has(b.id) ? 1000 : 0) +
        Math.abs(ma.balance + mb.balance) * 2 +
        i * 0.01;
      if (cost < bestCost) {
        best = i;
        bestCost = cost;
      }
    }
    const b = active.splice(best, 1)[0],
      ma = m.get(a.id)!,
      mb = m.get(b.id)!;
    const aWhite =
      ma.balance < mb.balance ||
      (ma.balance === mb.balance && (rounds.length + board) % 2 === 0);
    out.push({
      id: uid(),
      board: board++,
      whiteId: aWhite ? a.id : b.id,
      blackId: aWhite ? b.id : a.id,
      result: null,
      locked: false,
    });
  }
  const bye = out.find((p) => !p.blackId);
  if (bye) {
    bye.board = out.length;
    out.splice(out.indexOf(bye), 1);
    out.push(bye);
  }
  return out;
}
