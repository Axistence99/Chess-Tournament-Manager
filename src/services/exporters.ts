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
  if (s.tournament.finished) return "Final Rank";
  if (s.tournament.type === "Round Robin manual crosstable")
    return round ? "Current Ranking" : "Starting Rank";
  if (round === 0) return "Starting Rank";
  return `Rank after Round ${round}`;
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
      s.tournament.type === "Round Robin manual crosstable"
        ? `${s.rounds[0]?.pairings.filter((game) => game.result !== null).length || 0}/${s.rounds[0]?.pairings.length || 0} matchups recorded`
        : `${s.tournament.totalRounds} rounds`,
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
        ? [10, 26, 94, 164, 182, 200, 222, 246]
        : [10, 26, 86, 150, 168, 184, 200, 222, 242];
      row(
        [
          "Rk.",
          "Team",
          "Roster",
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
        row(
          [
            String(entry.rank),
            entry.team.name,
            entry.team.playerIds.map((id) => find(s, id)).join(", "),
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
        ? [10, 25, 80, 97, 116, 135, 147, 159, 177, 205, 226, 247]
        : [10, 25, 82, 100, 120, 140, 153, 166, 201, 225, 249];
      row(
        [
          "Rk.",
          "Name",
          "FED",
          "Rtg",
          "Pts.",
          "+",
          "=",
          "-",
          ...(ratingChanges ? ["ΔRtg"] : []),
          "TB1",
          "TB2",
          "TB3",
        ],
        positions,
      );
      standings(s.players, s.rounds).forEach((entry) => {
        const change = ratingChanges?.[entry.player.id] || 0;
        row(
          [
            String(entry.rank),
            entry.player.name,
            federation(entry.player.country),
            String(entry.player.rating || 0),
            entry.points.toFixed(1),
            String(entry.wins),
            String(entry.draws),
            String(entry.losses),
            ...(ratingChanges ? [`${change > 0 ? "+" : ""}${change}`] : []),
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
/** Escape user-controlled text before placing it in an OOXML worksheet. */
function xlsxXml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xlsxColumn(index: number): string {
  let result = "";
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

/** Create a standards-compliant Excel workbook without a server dependency. */
export async function makeXlsx(s: AppState, save = true): Promise<Blob> {
  if (!s.tournament.finished)
    throw new Error("Final results must be published before Excel export.");

  const teamFormat = s.tournament.type.startsWith("Team");
  const boardOnly = s.tournament.teamScoring === "board-points";
  const ratingChanges = s.tournament.rated
    ? s.tournament.ratingChanges
    : undefined;
  const headers = teamFormat
    ? [
        "Rank",
        "Team",
        "Roster",
        "Wins",
        "Draws",
        "Losses",
        ...(boardOnly ? [] : ["Match Points"]),
        "Board Points",
        "TB1 · Team Buchholz",
      ]
    : [
        "Rank",
        "Name",
        "Federation",
        "Rating",
        "Points",
        "Wins",
        "Draws",
        "Losses",
        ...(ratingChanges ? ["Rating Change"] : []),
        "TB1 · Buchholz",
        "TB2 · Buchholz Cut 1",
        "TB3 · Sonneborn-Berger",
      ];
  const values: Array<Array<string | number>> = teamFormat
    ? teamStandings(
        s.teams || [],
        s.rounds,
        s.tournament.teamScoring || "2-1-0",
      ).map((entry) => [
        entry.rank,
        entry.team.name,
        entry.team.playerIds.map((id) => find(s, id)).join(", "),
        entry.wins,
        entry.draws,
        entry.losses,
        ...(boardOnly ? [] : [entry.matchPoints]),
        entry.boardPoints,
        entry.buchholz,
      ])
    : standings(s.players, s.rounds).map((entry) => [
        entry.rank,
        entry.player.name,
        federation(entry.player.country),
        entry.player.rating || 0,
        entry.points,
        entry.wins,
        entry.draws,
        entry.losses,
        ...(ratingChanges ? [ratingChanges[entry.player.id] || 0] : []),
        entry.buchholz,
        entry.buchholzCut,
        entry.sonneborn,
      ]);

  const cell = (
    value: string | number,
    row: number,
    column: number,
    style: number,
  ) => {
    const reference = `${xlsxColumn(column)}${row}`;
    return typeof value === "number"
      ? `<c r="${reference}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`
      : `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xlsxXml(value)}</t></is></c>`;
  };
  const row = (
    rowNumber: number,
    columns: Array<string | number>,
    style: number,
    height?: number,
  ) =>
    `<row r="${rowNumber}"${height ? ` ht="${height}" customHeight="1"` : ""}>${columns.map((value, column) => cell(value, rowNumber, column, style)).join("")}</row>`;
  const lastColumn = xlsxColumn(headers.length - 1);
  const details = [
    s.tournament.date,
    s.tournament.venue || "Venue not set",
    s.tournament.type,
    s.tournament.type === "Round Robin manual crosstable"
      ? `${s.rounds[0]?.pairings.length || 0} matchups`
      : `${s.rounds.length} round${s.rounds.length === 1 ? "" : "s"}`,
    s.tournament.rated ? "Rated" : "Unrated",
  ].join(" · ");
  const widths = headers
    .map((header, index) => {
      const width =
        header === "Name" || header === "Team"
          ? 28
          : header === "Roster"
            ? 44
            : header.includes("Buchholz") || header.includes("Sonneborn")
              ? 22
              : 13;
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    })
    .join("");
  const dataRows = values
    .map((columns, index) => {
      const rank = Number(columns[0]);
      const style = rank === 1 ? 3 : rank === 2 ? 4 : rank === 3 ? 5 : 0;
      return row(index + 5, columns, style);
    })
    .join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${row(1, [`${s.tournament.name} · Final Results`], 1, 28)}${row(2, [details], 6, 20)}${row(4, headers, 2, 24)}${dataRows}</sheetData><autoFilter ref="A4:${lastColumn}${Math.max(4, values.length + 4)}"/><mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Aptos"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1C503A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6B83F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9DFDC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD69A70"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF3EF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD4DED8"/></left><right style="thin"><color rgb="FFD4DED8"/></right><top style="thin"><color rgb="FFD4DED8"/></top><bottom style="thin"><color rgb="FFD4DED8"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Final Results" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file("xl/worksheets/sheet1.xml", sheet);
  zip.file("xl/styles.xml", styles);
  const timestamp = new Date().toISOString();
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xlsxXml(s.tournament.name)} Final Results</dc:title><dc:creator>Chest-Tournament Manager</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created></cp:coreProperties>`,
  );
  zip.file(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Chest-Tournament Manager</Application></Properties>`,
  );
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (save) download(blob, `${slug(s.tournament.name)}-final-results.xlsx`);
  return blob;
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
