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
  const row = (cols: string[], positions: number[]) => {
    d.setFontSize(7.5);
    cols.forEach((value, index) =>
      d.text(String(value), positions[index] || positions.at(-1) || 12, y, {
        maxWidth: index === 3 && rankingReport ? 62 : 46,
      }),
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
      const positions = [12, 24, 88, 150, 169, 187, 204, 221, 242];
      row(
        ["Rk.", "Team", "Roster", "MP", "BP", "W", "D", "L", "TB1"],
        positions,
      );
      teamStandings(
        s.teams || [],
        s.rounds,
        s.tournament.teamScoring || "2-1-0",
      ).forEach((entry) =>
        row(
          [
            String(entry.rank),
            entry.team.name,
            entry.team.playerIds.map((id) => find(s, id)).join(", "),
            String(entry.matchPoints),
            entry.boardPoints.toFixed(1),
            String(entry.wins),
            String(entry.draws),
            String(entry.losses),
            entry.buchholz.toFixed(1),
          ],
          positions,
        ),
      );
    } else {
      const positions = [10, 20, 31, 40, 105, 119, 134, 190, 207, 225, 243];
      row(
        [
          "Rk.",
          "SNo",
          "",
          "Name",
          "FED",
          "Rtg",
          "Club/City",
          "Pts.",
          "TB1",
          "TB2",
          "TB3",
        ],
        positions,
      );
      standings(s.players, s.rounds).forEach((entry) => {
        const startNumber =
          s.players.findIndex((player) => player.id === entry.player.id) + 1;
        // Carry the podium hierarchy into print without compromising legibility.
        if (entry.rank === 1) d.setTextColor(148, 105, 25);
        else if (entry.rank === 2) d.setTextColor(90, 104, 101);
        else if (entry.rank === 3) d.setTextColor(139, 78, 43);
        else d.setTextColor(30);
        row(
          [
            String(entry.rank),
            String(startNumber),
            "",
            entry.player.name,
            federation(entry.player.country),
            String(entry.player.rating || 0),
            entry.player.club || "—",
            entry.points.toFixed(1),
            entry.buchholz.toFixed(1),
            entry.buchholzCut.toFixed(1),
            entry.sonneborn.toFixed(1),
          ],
          positions,
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
