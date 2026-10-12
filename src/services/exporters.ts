/** Browser-only PDF, image, and ZIP exporters for tournament reports. */
import { jsPDF } from "jspdf";
import { toPng, toJpeg } from "html-to-image";
import JSZip from "jszip";
import type { AppState } from "../models";
import { standings } from "./standings";
import { teamStandings } from "./teamTournament";
import { pgn } from "./pgnExporter";
import { download, slug } from "./storage";
const find = (s: AppState, id: string | null) =>
  s.players.find((p) => p.id === id)?.name || "—";
function federation(country: string): string {
  const aliases: Record<string, string> = {
    philippines: "PHI",
    ph: "PHI",
    usa: "USA",
    "united states": "USA",
    india: "IND",
    indonesia: "INA",
    malaysia: "MAS",
    singapore: "SGP",
  };
  return (
    aliases[country.trim().toLowerCase()] ||
    country.toUpperCase().slice(0, 3) ||
    "—"
  );
}

function reportTitle(s: AppState): string {
  const round = s.rounds.at(-1)?.number || 0;
  const missing =
    s.rounds.at(-1)?.pairings.filter((game) => game.result === null).length ||
    0;
  if (s.tournament.finished) return "Final Rank";
  if (round === 0) return "Starting Rank";
  return `Rank after Round ${round}${missing ? ` (${missing} results missing)` : ""}`;
}

/** Build a print-ready report entirely in the browser. */
export function makePdf(
  s: AppState,
  kind: "standings" | "pairings" | "players" | "crosstable" = "standings",
  save = true,
) {
  const rankingReport = kind === "standings" || kind === "crosstable";
  const d = new jsPDF({
    orientation: rankingReport ? "landscape" : "portrait",
  });
  const pageWidth = d.internal.pageSize.getWidth();
  const pageHeight = d.internal.pageSize.getHeight();
  const gold: [number, number, number] = [190, 145, 66];

  const drawHeading = () => {
    d.setFillColor(22, 73, 52);
    d.rect(0, 0, pageWidth, 39, "F");
    d.setTextColor(255);
    d.setFontSize(18);
    d.text(s.tournament.name, 12, 13);
    d.setFontSize(11);
    d.text(rankingReport ? reportTitle(s) : kind.toUpperCase(), 12, 22);
    d.setFontSize(8);
    const details = [
      s.tournament.venue || "Venue not set",
      s.tournament.date,
      s.tournament.organizer ? `Organizer: ${s.tournament.organizer}` : "",
      s.tournament.type,
      `Time control: ${s.tournament.timeControl}`,
      `${s.tournament.totalRounds} rounds`,
    ]
      .filter(Boolean)
      .join("  •  ");
    d.text(details, 12, 31, { maxWidth: pageWidth - 24 });
  };

  drawHeading();
  d.setTextColor(30);
  let y = 49;
  const crownColors: Array<[number, number, number]> = [
    [205, 158, 45],
    [157, 169, 173],
    [173, 101, 58],
  ];
  const drawCrown = (rank: number, x: number) => {
    const color = crownColors[rank - 1];
    if (!color) return;
    d.setFillColor(...color);
    d.rect(x, y - 2.5, 5, 2, "F");
    d.triangle(x, y - 2.5, x + 0.8, y - 5.5, x + 1.7, y - 2.5, "F");
    d.triangle(x + 1.7, y - 2.5, x + 2.5, y - 6.2, x + 3.3, y - 2.5, "F");
    d.triangle(x + 3.3, y - 2.5, x + 4.2, y - 5.5, x + 5, y - 2.5, "F");
  };
  const row = (cols: string[], positions: number[], podiumRank?: number) => {
    const crowned =
      s.tournament.finished && podiumRank && podiumRank >= 1 && podiumRank <= 3;
    d.setFontSize(7.5);
    if (crowned) drawCrown(podiumRank, positions[0]);
    cols.forEach((value, index) =>
      d.text(
        String(value),
        (positions[index] || positions.at(-1) || 12) +
          (crowned && index === 0 ? 6 : 0),
        y,
        {
          maxWidth: rankingReport && index === 2 ? 44 : 46,
        },
      ),
    );
    d.setDrawColor(214);
    d.line(10, y + 2.5, pageWidth - 10, y + 2.5);
    y += 7;
    if (y > pageHeight - 15) {
      d.addPage();
      drawHeading();
      y = 49;
    }
  };

  if (rankingReport) {
    const teamFormat = s.tournament.type.startsWith("Team");
    if (teamFormat) {
      const boardOnly = s.tournament.teamScoring === "board-points";
      const positions = boardOnly
        ? [10, 24, 36, 91, 157, 177, 192, 207, 224, 246]
        : [10, 24, 36, 84, 146, 164, 178, 192, 206, 222, 240];
      row(
        [
          "Rk.",
          "SNo",
          "Team",
          "Roster",
          "Games",
          "+",
          "=",
          "-",
          ...(boardOnly ? [] : ["MP"]),
          "BP",
          "TB1",
        ],
        positions,
      );
      teamStandings(
        s.teams || [],
        s.rounds,
        s.tournament.teamScoring || "2-1-0",
      ).forEach((entry) => {
        const startNumber =
          (s.teams || []).findIndex((team) => team.id === entry.team.id) + 1;
        row(
          [
            String(entry.rank),
            String(startNumber),
            entry.team.name,
            entry.team.playerIds.map((id) => find(s, id)).join(", "),
            String(entry.wins + entry.draws + entry.losses),
            String(entry.wins),
            String(entry.draws),
            String(entry.losses),
            ...(boardOnly ? [] : [String(entry.matchPoints)]),
            entry.boardPoints.toFixed(1),
            entry.buchholz.toFixed(1),
          ],
          positions,
          entry.rank,
        );
      });
    } else {
      const ratingChanges = s.tournament.rated
        ? s.tournament.ratingChanges
        : undefined;
      const positions = ratingChanges
        ? [10, 24, 35, 82, 96, 110, 127, 137, 147, 157, 171, 188, 226, 242, 258]
        : [10, 24, 35, 87, 101, 116, 134, 145, 156, 167, 181, 218, 237, 256];
      row(
        [
          "Rk.",
          "SNo",
          "Name",
          "FED",
          "Rtg",
          "Games",
          "+",
          "=",
          "-",
          "Pts.",
          ...(ratingChanges ? ["ΔRtg"] : []),
          "Club/City",
          "TB1",
          "TB2",
          "TB3",
        ],
        positions,
      );
      standings(s.players, s.rounds).forEach((entry) => {
        const startNumber =
          s.players.findIndex((player) => player.id === entry.player.id) + 1;
        const change = ratingChanges?.[entry.player.id] || 0;
        row(
          [
            String(entry.rank),
            String(startNumber),
            entry.player.name,
            federation(entry.player.country),
            String(entry.player.rating || 0),
            String(entry.wins + entry.draws + entry.losses),
            String(entry.wins),
            String(entry.draws),
            String(entry.losses),
            entry.points.toFixed(1),
            ...(ratingChanges ? [`${change > 0 ? "+" : ""}${change}`] : []),
            entry.player.club || "—",
            entry.buchholz.toFixed(1),
            entry.buchholzCut.toFixed(1),
            entry.sonneborn.toFixed(1),
          ],
          positions,
          entry.rank,
        );
      });
    }
  } else if (kind === "players") {
    const positions = [14, 29, 94, 122, 162];
    row(["#", "Player", "Rating", "Club", "Country"], positions);
    [...s.players]
      .sort((a, b) => b.rating - a.rating)
      .forEach((profile, index) =>
        row(
          [
            String(index + 1),
            profile.name,
            String(profile.rating),
            profile.club,
            profile.country,
          ],
          positions,
        ),
      );
  } else {
    const round = s.rounds.at(-1);
    const positions = [14, 29, 94, 108, 174];
    row(["Bd", "White", "", "Black", "Result"], positions);
    round?.pairings.forEach((game) =>
      row(
        [
          String(game.board),
          find(s, game.whiteId),
          "vs",
          find(s, game.blackId),
          game.result || "*",
        ],
        positions,
      ),
    );
  }

  const pages = d.getNumberOfPages();
  for (let index = 1; index <= pages; index++) {
    d.setPage(index);
    d.setTextColor(...gold);
    d.setFontSize(8);
    d.text(
      `Chest-Tournament Manager  •  Page ${index} of ${pages}`,
      pageWidth / 2,
      pageHeight - 6,
      {
        align: "center",
      },
    );
  }
  if (save) d.save(`${slug(s.tournament.name)}-${kind}.pdf`);
  return d.output("blob");
}
/** Rasterize a themed DOM report at a social-media-friendly resolution. */
export async function makeImage(
  el: HTMLElement,
  type: "png" | "jpg",
  size: string,
  save = true,
) {
  const [width, height] = size.split("x").map(Number);
  const opts = {
    width,
    height,
    pixelRatio: 1,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      padding: "56px",
      boxSizing: "border-box",
      background: "#0b1210",
    },
  };
  const data =
    type === "png"
      ? await toPng(el, opts)
      : await toJpeg(el, { ...opts, quality: 0.94 });
  if (save) {
    const a = document.createElement("a");
    a.download = `chest-tournament-${Date.now()}.${type}`;
    a.href = data;
    a.click();
  }
  return data;
}
/** Package the event's primary interchange and presentation formats. */
export async function makeZip(s: AppState, poster: HTMLElement) {
  const z = new JSZip();
  z.file("Tournament.pgn", pgn(s));
  z.file("Standings.pdf", await makePdf(s, "standings", false));
  z.file("Pairings.pdf", await makePdf(s, "pairings", false));
  const data = await makeImage(poster, "png", "1080x1350", false);
  z.file("Standings.png", data.split(",")[1], { base64: true });
  z.file("Backup.json", JSON.stringify(s, null, 2));
  download(
    await z.generateAsync({ type: "blob" }),
    `${slug(s.tournament.name)}-package.zip`,
  );
}
