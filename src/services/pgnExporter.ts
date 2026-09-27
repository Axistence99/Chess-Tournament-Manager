import type { AppState, Pairing } from "../models";
const res = (r: Pairing["result"]) =>
  r === "½-½"
    ? "1/2-1/2"
    : r === "1F-0F"
      ? "1-0"
      : r === "0F-1F"
        ? "0-1"
        : r === "BYE"
          ? "1-0"
          : r || "*";
/** Serialize completed and pending boards into standards-compatible PGN text. */
export function pgn(state: AppState, roundNumber?: number) {
  const rounds = roundNumber
    ? state.rounds.filter((r) => r.number === roundNumber)
    : state.rounds;
  const find = (id: string | null) => state.players.find((p) => p.id === id);
  return rounds
    .flatMap((r) =>
      r.pairings
        .filter((g) => g.blackId)
        .map((g) => {
          const w = find(g.whiteId)!,
            b = find(g.blackId)!;
          const tags = [
            ["Event", state.tournament.name],
            ["Site", state.tournament.venue],
            ["Date", state.tournament.date.replaceAll("-", ".")],
            ["Round", `${r.number}.${g.board}`],
            ["White", w.name],
            ["Black", b.name],
            ["Result", res(g.result)],
            ["WhiteElo", String(w.rating)],
            ["BlackElo", String(b.rating)],
            ["TimeControl", state.tournament.timeControl],
          ];
          return (
            tags
              .map(([k, v]) => `[${k} "${String(v).replaceAll('"', '\\"')}"]`)
              .join("\n") + `\n\n${res(g.result)}\n`
          );
        }),
    )
    .join("\n");
}
