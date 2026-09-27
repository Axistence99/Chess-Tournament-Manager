/**
 * Browser application entry point: renders every screen, coordinates user
 * interactions, and persists tournament changes through the service layer.
 */
import "./styles/main.css";
import { createIcons, icons } from "lucide";
import Papa from "papaparse";
import type { AppState, GameResult, Player, Round, Tournament } from "./models";
import { storage, download, slug } from "./services/storage";
import {
  generateKnockout,
  generateRoundRobin,
  generateSwiss,
  knockoutRoundCount,
} from "./services/pairingEngine";
import { standings } from "./services/standings";
import { pgn } from "./services/pgnExporter";
import { makeImage, makePdf, makeZip } from "./services/exporters";
import { categoryForAge } from "./utils/player";
import {
  FEDERATIONS,
  federationName,
  iso2ForFederation,
} from "./utils/federations";
import { escapeHtml as h, icon } from "./utils/html";
import { playerAvatar as avatarMarkup } from "./components/PlayerAvatar";
import { compressAvatar } from "./services/avatar";
import { PRESET_PLAYERS } from "./data/presetPlayers";

// -----------------------------------------------------------------------------
// Application bootstrap and in-memory UI state
// -----------------------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>("#app")!;
const uid = () => crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
const emptyState = (): AppState => ({
  tournament: {
    id: uid(),
    name: "",
    venue: "",
    organizer: "",
    date: today,
    timeControl: "90+30",
    totalRounds: 5,
    type: "Swiss System",
    createdAt: new Date().toISOString(),
    finished: false,
  },
  players: [],
  rounds: [],
  view: "dashboard",
});
const PRESET_SEED_KEY = "castling.player-presets.v1";
const THEME_KEY = "castling.theme.v1";
type AppTheme = "dark" | "light" | "criterion";
const THEMES: AppTheme[] = ["dark", "light", "criterion"];
let activeTheme: AppTheme = THEMES.includes(
  localStorage.getItem(THEME_KEY) as AppTheme,
)
  ? (localStorage.getItem(THEME_KEY) as AppTheme)
  : "dark";

/** Apply the visual theme globally and keep browser chrome in sync. */
function applyTheme(theme: AppTheme): void {
  activeTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme =
    theme === "light" ? "light" : "dark";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      theme === "light"
        ? "#f3f6f4"
        : theme === "criterion"
          ? "#1c503a"
          : "#0b1210",
    );
  localStorage.setItem(THEME_KEY, theme);
}

applyTheme(activeTheme);

/** Add starter profiles once, while respecting profiles an organizer already has. */
function seedPresetPlayers(): void {
  if (localStorage.getItem(PRESET_SEED_KEY)) return;
  const existingNames = new Set(
    storage.listPlayers().map((profile) => profile.name.trim().toLowerCase()),
  );
  for (const preset of PRESET_PLAYERS) {
    if (!existingNames.has(preset.name.toLowerCase()))
      storage.savePlayer(preset);
  }
  localStorage.setItem(PRESET_SEED_KEY, new Date().toISOString());
}

try {
  seedPresetPlayers();
} catch (error) {
  // Storage can be disabled in strict privacy modes; the app remains usable in
  // memory and will surface a normal save error only when persistence is needed.
  console.warn("Starter player profiles could not be created", error);
}

// Remove the pristine placeholder created by versions before the dedicated
// creation screen existed. Real tournaments and edited placeholders are kept.
const initialLibrary = storage.list();
const obsoletePlaceholder =
  initialLibrary.length === 1 &&
  ["My Chess Open", "New Tournament"].includes(
    initialLibrary[0].tournament.name,
  ) &&
  ["Tournament Hall", "Venue not set"].includes(
    initialLibrary[0].tournament.venue,
  ) &&
  initialLibrary[0].players.length === 0 &&
  initialLibrary[0].rounds.length === 0;
if (obsoletePlaceholder) storage.remove(initialLibrary[0].tournament.id);

let hasTournament = storage.list().length > 0;
let state = storage.load() || emptyState();
let draftingNewTournament = false;
let modal = "";
let selectedPlayer: string | null = null;
let selectedRound: number | null = null;
let exportOpen = false;
let projector = false;
let projectorSlide = 0;
let projectorTimer = 0;
let search = "";
let sort: "rating" | "name" = "rating";
let lastFocusedElement: HTMLElement | null = null;
let pendingAvatar = "";
// Read-only selectors keep tournament calculations out of rendering templates.
const player = (id: string | null) =>
  state.players.find((profile) => profile.id === id) ||
  storage.listPlayers().find((profile) => profile.id === id);
const currentRound = () => state.rounds.at(-1);
const isComplete = (r?: Round) =>
  !!r && r.pairings.every((g) => g.result !== null);
const gamesDone = () =>
  state.rounds.flatMap((r) => r.pairings).filter((g) => g.result !== null)
    .length;
const gamesTotal = () =>
  state.rounds.reduce((n, r) => n + r.pairings.length, 0);
const tournamentStarted = () => state.rounds.length > 0;
const canEndTournament = () => {
  const finalRound = currentRound();
  return (
    !state.tournament.finished &&
    state.rounds.length === state.tournament.totalRounds &&
    isComplete(finalRound)
  );
};
type ToastTone = "success" | "error" | "info";

/** Persist a completed action and report storage failures instead of hiding them. */
const save = (message = "Saved locally") => {
  try {
    storage.save(state);
    toast(message, "success");
  } catch (error) {
    console.error(error);
    toast("Unable to save. Browser storage may be full.", "error");
  }
};

/**
 * Apply frequent interactions immediately, then persist on the next frame.
 * If localStorage rejects the write, the previous state is restored.
 */
function optimisticUpdate(change: () => void, message?: string): void {
  const previous = structuredClone(state);
  change();
  render();
  const status = document.querySelector("#save-status");
  if (status) status.textContent = "Saving…";
  requestAnimationFrame(() => {
    try {
      storage.save(state);
      if (message) toast(message, "success");
    } catch (error) {
      console.error(error);
      state = previous;
      render();
      toast("The change could not be saved and was reverted.", "error");
    }
  });
}

/** Close dialogs and discard an unsaved new-tournament draft safely. */
function closeModal(): void {
  if (draftingNewTournament) {
    state = storage.load() || state;
    draftingNewTournament = false;
  }
  modal = "";
  selectedPlayer = null;
  document.body.classList.remove("modal-open");
}

/** Animate a sheet out before removing it from the accessibility tree. */
function requestModalClose(): void {
  const backdrop = document.querySelector<HTMLElement>(".modal-backdrop");
  if (!backdrop) {
    closeModal();
    render();
    return;
  }
  backdrop.classList.add("closing");
  window.setTimeout(
    () => {
      closeModal();
      render();
      lastFocusedElement?.focus();
    },
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
  );
}

/** Stack non-blocking announcements and keep errors available slightly longer. */
function toast(message: string, tone: ToastTone = "info") {
  let region = document.querySelector<HTMLElement>(".toast-region");
  if (!region) {
    region = document.createElement("div");
    region.className = "toast-region";
    region.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
    region.setAttribute("aria-atomic", "false");
    document.body.append(region);
  }
  const item = document.createElement("div");
  item.className = `toast toast-${tone}`;
  item.setAttribute("role", tone === "error" ? "alert" : "status");
  item.innerHTML = `<span class="toast-mark" aria-hidden="true">${tone === "success" ? "✓" : tone === "error" ? "!" : "i"}</span><span>${h(message)}</span><button aria-label="Dismiss notification">×</button>`;
  const dismiss = () => {
    item.classList.add("leaving");
    setTimeout(() => item.remove(), 160);
  };
  item.querySelector("button")?.addEventListener("click", dismiss);
  region.append(item);
  window.setTimeout(dismiss, tone === "error" ? 5200 : 3000);
}

// -----------------------------------------------------------------------------
// Navigation shell and shared layout fragments
// -----------------------------------------------------------------------------

const nav = [
  ["dashboard", "layout-dashboard", "Dashboard"],
  ["players", "users", "Players"],
  ["pairings", "swords", "Pairings"],
  ["standings", "trophy", "Standings"],
  ["history", "history", "Rounds"],
];
function shell(content: string) {
  const active = state.view;
  const navButtons = (mobile = false) =>
    nav
      .map(
        ([v, i, l]) =>
          `<button data-view="${v}" class="${active === v ? "active" : ""}" aria-current="${active === v ? "page" : "false"}">${icon(i, mobile ? 19 : 17)}<span>${l}</span></button>`,
      )
      .join("");
  return `<div class="app"><aside class="sidebar"><div class="brand"><img src="./chest-logo.webp" alt=""><div><strong>Chest-Tournament</strong><small>Manager</small></div></div><nav class="nav" aria-label="Main navigation">${navButtons()}</nav><div class="sidebar-foot"><button class="btn" data-action="projector">${icon("presentation")} Projector mode</button><div class="autosave"><span class="dot"></span><span id="save-status">Autosaved locally</span></div></div></aside><main id="main" tabindex="-1"><header class="topbar"><button class="tournament-switcher" data-action="choose-tournament" aria-label="Choose tournament"><span><h1>${h(state.tournament.name)}</h1><p>${state.tournament.type} · ${state.rounds.length ? `Round ${state.rounds.length}` : "Ready to begin"}</p></span>${icon("chevrons-up-down", 15)}</button><div class="toolbar"><button class="btn" data-action="app-settings" aria-label="Appearance settings">${icon("palette")}<span class="hide-mobile"> Theme</span></button><button class="btn" data-action="backup" aria-label="Download backup">${icon("cloud-download")}<span class="hide-mobile"> Backup</span></button>${exportMenu()}</div></header><div class="content">${content}</div></main><nav class="mobile-nav" aria-label="Mobile navigation">${navButtons(true)}</nav></div>${poster()}${modalView()}${projector ? projectorView() : ""}<input hidden type="file" id="restore-file" accept=".json,application/json">`;
}
function exportMenu() {
  return `<div class="export-menu"><button class="btn" data-action="restore">${icon("upload")}<span class="hide-mobile"> Restore</span></button><button class="btn primary" data-action="toggle-export">${icon("download")}<span class="export-label">Export</span>${icon("chevron-down", 14)}</button>${exportOpen ? `<div class="dropdown" role="menu"><button data-export="pgn">${icon("file-text")} PGN · Tournament</button><button data-export="pdf-standings">${icon("file-text")} PDF · Standings</button><button data-export="pdf-pairings">${icon("file-text")} PDF · Pairings</button><button data-export="pdf-players">${icon("file-text")} PDF · Player list</button><button data-export="png">${icon("image")} PNG · 1080×1350</button><button data-export="jpg">${icon("image")} JPG · 1920×1080</button><button data-export="zip">${icon("package")} ZIP tournament package</button></div>` : ""}</div>`;
}
function metrics() {
  const done = gamesDone(),
    total = gamesTotal();
  const progress = total ? Math.round((done / total) * 100) : 0;
  return `<div class="metrics"><div class="metric"><b>${state.players.filter((p) => p.active).length}</b><span>Active players</span></div><div class="metric"><b>${state.rounds.length}<small> / ${state.tournament.totalRounds}</small></b><span>Current round</span></div><div class="metric"><b>${done}</b><span>Games completed</span></div><div class="metric"><b>${progress}%</b><span>Tournament progress</span></div></div>`;
}
// -----------------------------------------------------------------------------
// Page renderers
// -----------------------------------------------------------------------------

/** First-run setup is a real tournament form, never a saved placeholder event. */
function creationPage() {
  const t = state.tournament;
  return `<main class="creation-page" id="main">
    <section class="creation-intro">
      <div class="creation-identity"><img src="./chest-logo.webp" alt="Chest-Tournament Manager logo"><strong>Chest-Tournament Manager</strong></div>
      <span class="eyebrow">Tournament setup</span>
      <h1>Create your tournament</h1>
      <p>Set the event details first. Your dashboard, player directory, pairings, standings, and exports become available after creation.</p>
      <div class="creation-features" aria-label="Application features">
        <span>${icon("users", 18)} Reusable player profiles</span>
        <span>${icon("swords", 18)} Automatic pairings</span>
        <span>${icon("trophy", 18)} Live standings</span>
        <span>${icon("hard-drive", 18)} Saved locally</span>
      </div>
      <div class="toolbar creation-tools">
        <button class="btn" data-action="restore">${icon("upload")} Import backup</button>
        <button class="btn" data-action="app-settings">${icon("palette")} Theme</button>
      </div>
    </section>
    <section class="creation-card" aria-labelledby="create-title">
      <span class="eyebrow">New event</span>
      <h2 id="create-title">Tournament details</h2>
      <form id="creation-form">
        <div class="form-grid">
          <div class="field full-field"><label>Tournament name *</label><input name="name" required autofocus placeholder="e.g. City Chess Open" value="${h(t.name)}"></div>
          <div class="field"><label>Venue</label><input name="venue" placeholder="Playing venue" value="${h(t.venue)}"></div>
          <div class="field"><label>Organizer</label><input name="organizer" placeholder="Organizer or club" value="${h(t.organizer)}"></div>
          <div class="field"><label>Date</label><input name="date" type="date" value="${t.date}"></div>
          <div class="field"><label>Time control</label><input name="timeControl" value="${h(t.timeControl)}"></div>
          <div class="field"><label>Number of rounds</label><input name="totalRounds" type="number" min="1" max="30" value="${t.totalRounds}"><small>Calculated automatically for Knockout.</small></div>
          <div class="field"><label>Tournament type</label><select name="type">${["Swiss System", "Round Robin", "Knockout", "Team"].map((type) => `<option ${t.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></div>
        </div>
        <button class="btn primary creation-submit" type="submit">${icon("arrow-right")} Create tournament</button>
      </form>
    </section>
  </main>${modalView()}<input hidden type="file" id="restore-file" accept=".json,application/json">`;
}

function dashboard() {
  const leaders = standings(state.players, state.rounds).slice(0, 5);
  return `<section class="hero"><span class="eyebrow">${state.tournament.finished ? "Tournament complete" : "Tournament control"}</span><h2>${h(state.tournament.name)}</h2><p class="muted">${icon("map-pin", 14)} ${h(state.tournament.venue)} &nbsp;·&nbsp; ${h(state.tournament.date)} &nbsp;·&nbsp; ${h(state.tournament.timeControl)}</p></section>${metrics()}<div class="section-head"><h3>Quick actions</h3><button class="btn" data-action="edit-tournament" ${tournamentStarted() ? 'disabled data-tooltip="Tournament settings lock when Round 1 starts"' : ""}>${icon(tournamentStarted() ? "lock" : "settings")} Tournament settings</button></div><div class="quick"><button data-action="new-tournament">${icon("plus-circle")}<b>New tournament</b><span class="muted">Start from scratch</span></button><button type="button" data-action="add-player">${icon("user-plus")}<b>Add player</b><span class="muted">Build the field</span></button><button data-view="standings">${icon("bar-chart-3")}<b>Live standings</b><span class="muted">View leaderboard</span></button><button data-action="toggle-export">${icon("download")}<b>Export center</b><span class="muted">Reports & packages</span></button></div><div class="section-head"><h3>${state.tournament.finished ? "Final Rank" : "Current standings"}</h3><span class="muted">${state.tournament.finished ? "Official final tie-breaks" : "Provisional tie-breaks"}</span></div>${leaders.length ? standingsTable(leaders) : empty("♟", "Your tournament is ready", "Add players to begin pairing your first round.", "Add players", "add-player")}`;
}
function empty(
  chess: string,
  title: string,
  text: string,
  label: string,
  action: string,
) {
  return `<div class="card empty"><div class="chess">${chess}</div><h3>${title}</h3><p class="muted">${text}</p><button type="button" class="btn primary" data-action="${action}">${icon("plus")} ${label}</button></div>`;
}
function playersView() {
  const registeredIds = new Set(state.players.map((profile) => profile.id));
  let list = storage
    .listPlayers()
    .filter(
      (profile) =>
        profile.name.toLowerCase().includes(search.toLowerCase()) ||
        profile.club.toLowerCase().includes(search.toLowerCase()),
    );
  list = [...list].sort(
    sort === "rating"
      ? (a, b) => b.rating - a.rating
      : (a, b) => a.name.localeCompare(b.name),
  );

  return `<div class="section-head">
    <div><span class="eyebrow">Player directory</span><h2>Player management</h2><p class="muted">Create reusable profiles, then register them for ${h(state.tournament.name)}.</p></div>
    <div class="toolbar">
      <input class="search" id="player-search" value="${h(search)}" placeholder="Search player profiles…" aria-label="Search player profiles">
      <button class="btn" data-action="sort">${icon("arrow-up-down")} ${sort === "rating" ? "Rating" : "Name"}</button>
      <button class="btn" data-action="import-csv">${icon("upload")} CSV</button>
      <button class="btn" data-action="export-csv">${icon("download")} CSV</button>
      <button type="button" class="btn primary" data-action="add-player">${icon("user-plus")} New profile</button>
    </div>
  </div>
  <div class="roster-summary"><span><b>${state.players.filter((profile) => profile.active).length}</b> registered for this tournament</span><span><b>${list.length}</b> profiles in your directory</span></div>
  ${
    list.length
      ? `<div class="table-wrap"><table><thead><tr><th>Player</th><th>Rating</th><th>Age</th><th>Category</th><th>Club</th><th>Federation</th><th>Tournament</th><th></th></tr></thead><tbody>${list
          .map((profile) => {
            const registered = registeredIds.has(profile.id);
            return `<tr><td><button class="icon-btn" data-player="${profile.id}" style="color:inherit">${avatarMarkup(profile)}<b>${h(profile.name)}</b></button></td><td class="mono">${profile.rating}</td><td>${profile.age || "—"}</td><td><span class="pill">${h(profile.ageCategory || categoryForAge(profile.age))}</span></td><td>${h(profile.club || "—")}</td><td class="federation-cell">${profile.country ? countryFlag(profile.country) : "—"}</td><td>${
              registered
                ? `<button class="btn registration registered" data-remove-from-tournament="${profile.id}">${icon("check", 14)} Registered</button>`
                : `<button class="btn registration" data-add-to-tournament="${profile.id}">${icon("plus", 14)} Add to tournament</button>`
            }</td><td><button class="icon-btn" data-edit-player="${profile.id}" aria-label="Edit ${h(profile.name)}">${icon("pencil")}</button><button class="icon-btn" data-delete-player="${profile.id}" aria-label="Delete ${h(profile.name)}">${icon("trash-2")}</button></td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : empty(
          "♙",
          "No player profiles yet",
          "Create a player once, then reuse that profile in any tournament.",
          "Create first profile",
          "add-player",
        )
  }
  <input hidden type="file" id="csv-file" accept=".csv,text/csv">`;
}
function knockoutRoundLabel(number: number): string {
  const remaining = state.tournament.totalRounds - number;
  if (remaining === 0) return "Final";
  if (remaining === 1) return "Semifinal";
  if (remaining === 2) return "Quarterfinal";
  return `Round ${number}`;
}

function knockoutWinnerId(game: Round["pairings"][number]): string | null {
  if (!game.blackId || game.result === "BYE") return game.whiteId;
  if (game.result === "1-0" || game.result === "1F-0F") return game.whiteId;
  if (game.result === "0-1" || game.result === "0F-1F") return game.blackId;
  return null;
}

/** Render all generated and future elimination rounds as a responsive bracket. */
function knockoutBracketView(): string {
  const totalRounds = state.tournament.totalRounds;
  const cardWidth = 178;
  const columnGap = 48;
  const rowStep = 112;
  const headerHeight = 62;
  // Two-to-four-player events read more clearly as a compact, one-sided tree.
  // Larger fields use the mirrored World-Cup-style layout around the final.
  const compact = totalRounds <= 2;
  const sideFirstMatches = totalRounds > 1 ? 2 ** (totalRounds - 2) : 1;
  const firstMatchRows = compact
    ? 2 ** Math.max(totalRounds - 1, 0)
    : sideFirstMatches;
  const columnCount = compact ? totalRounds : Math.max(1, totalRounds * 2 - 1);
  const width =
    columnCount * cardWidth + Math.max(columnCount - 1, 0) * columnGap;
  const height = headerHeight + firstMatchRows * rowStep;
  const seeds = new Map(
    state.players
      .filter((profile) => profile.active)
      .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
      .map((profile, index) => [profile.id, index + 1]),
  );
  const xForColumn = (column: number) => column * (cardWidth + columnGap);
  const centerFor = (roundIndex: number, localMatch: number) =>
    headerHeight + (localMatch + 0.5) * 2 ** roundIndex * rowStep;

  const connectors: string[] = [];
  if (compact) {
    // A compact tree flows in one direction when the field has at most four players.
    for (let roundIndex = 0; roundIndex < totalRounds - 1; roundIndex++) {
      const nextMatches = 2 ** (totalRounds - roundIndex - 2);
      const startX = xForColumn(roundIndex) + cardWidth;
      const middleX = startX + columnGap / 2;
      const endX = xForColumn(roundIndex + 1);
      for (let matchIndex = 0; matchIndex < nextMatches; matchIndex++) {
        const upperY = centerFor(roundIndex, matchIndex * 2);
        const lowerY = centerFor(roundIndex, matchIndex * 2 + 1);
        const nextY = centerFor(roundIndex + 1, matchIndex);
        connectors.push(
          `<path d="M ${startX} ${upperY} H ${middleX} V ${lowerY} H ${startX} M ${middleX} ${nextY} H ${endX}" />`,
        );
      }
    }
  } else {
    // Larger fields advance independently from both sides toward the centered final.
    for (let roundIndex = 0; roundIndex < totalRounds - 2; roundIndex++) {
      const nextMatchesPerSide = 2 ** (totalRounds - roundIndex - 3);
      for (const side of ["left", "right"] as const) {
        const currentColumn =
          side === "left" ? roundIndex : columnCount - 1 - roundIndex;
        const nextColumn =
          side === "left" ? currentColumn + 1 : currentColumn - 1;
        const startX =
          side === "left"
            ? xForColumn(currentColumn) + cardWidth
            : xForColumn(currentColumn);
        const middleX =
          startX + (side === "left" ? columnGap / 2 : -columnGap / 2);
        const endX =
          side === "left"
            ? xForColumn(nextColumn)
            : xForColumn(nextColumn) + cardWidth;
        for (
          let matchIndex = 0;
          matchIndex < nextMatchesPerSide;
          matchIndex++
        ) {
          const upperY = centerFor(roundIndex, matchIndex * 2);
          const lowerY = centerFor(roundIndex, matchIndex * 2 + 1);
          const nextY = centerFor(roundIndex + 1, matchIndex);
          connectors.push(
            `<path d="M ${startX} ${upperY} H ${middleX} V ${lowerY} H ${startX} M ${middleX} ${nextY} H ${endX}" />`,
          );
        }
      }
    }
    if (totalRounds > 1) {
      const centerY = headerHeight + (sideFirstMatches * rowStep) / 2;
      const finalColumn = totalRounds - 1;
      connectors.push(
        `<path class="final-connector" d="M ${xForColumn(finalColumn - 1) + cardWidth} ${centerY} H ${xForColumn(finalColumn)} M ${xForColumn(finalColumn + 1)} ${centerY} H ${xForColumn(finalColumn) + cardWidth}" />`,
      );
    }
  }

  const matchMarkup = (
    roundIndex: number,
    matchIndex: number,
    localMatch: number,
  ) => {
    const number = roundIndex + 1;
    const round = state.rounds.find((entry) => entry.number === number);
    const game = round?.pairings[matchIndex];
    const winner = game ? knockoutWinnerId(game) : null;
    const previousRound = number - 1;
    const firstFallback = `Winner ${previousRound}.${matchIndex * 2 + 1}`;
    const secondFallback = `Winner ${previousRound}.${matchIndex * 2 + 2}`;
    const first = game ? player(game.whiteId) : undefined;
    const second = game ? player(game.blackId) : undefined;
    const competitor = (
      profile: Player | undefined,
      fallback: string,
      id?: string | null,
    ) =>
      `<div class="bracket-player ${winner && id === winner ? "winner" : ""} ${!profile ? "pending" : ""}">${profile ? `<span class="bracket-seed">${seeds.get(profile.id) || ""}</span><span class="bracket-name">${h(profile.name)}</span><b>${profile.rating}</b>` : `<span class="bracket-name">${fallback}</span>`}</div>`;
    const top =
      (roundIndex === totalRounds - 1
        ? headerHeight + (firstMatchRows * rowStep) / 2
        : centerFor(roundIndex, localMatch)) - 43;
    return `<article class="bracket-match ${game?.result ? "decided" : ""}" style="top:${top}px"><span class="bracket-match-no">Match ${number}.${matchIndex + 1}</span>${competitor(first, firstFallback, game?.whiteId)}${competitor(second, game?.blackId ? secondFallback : game ? "BYE" : secondFallback, game?.blackId)}${game?.result ? `<span class="bracket-result">${game.result === "BYE" ? "Advances" : game.result}</span>` : ""}</article>`;
  };

  const columnMarkup = (
    roundIndex: number,
    side: "left" | "right" | "final",
  ) => {
    const number = roundIndex + 1;
    const fullMatchCount = 2 ** (totalRounds - number);
    const matchCount = side === "final" ? 1 : fullMatchCount / 2;
    const matchOffset = side === "right" ? matchCount : 0;
    const column =
      side === "left"
        ? roundIndex
        : side === "right"
          ? columnCount - 1 - roundIndex
          : totalRounds - 1;
    const matches = Array.from({ length: matchCount }, (_, localMatch) =>
      matchMarkup(roundIndex, matchOffset + localMatch, localMatch),
    ).join("");
    return `<section class="bracket-round ${side === "final" ? "championship-round" : `bracket-${side}`}" style="left:${xForColumn(column)}px;width:${cardWidth}px"><header><span>${side === "final" ? "Championship" : `${side} side · Round ${number}`}</span><strong>${knockoutRoundLabel(number)}</strong></header><div class="bracket-matches">${matches}</div></section>`;
  };

  const columns: string[] = [];
  if (compact) {
    for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
      const number = roundIndex + 1;
      const matchCount = 2 ** (totalRounds - number);
      const matches = Array.from({ length: matchCount }, (_, matchIndex) =>
        matchMarkup(roundIndex, matchIndex, matchIndex),
      ).join("");
      columns.push(
        `<section class="bracket-round ${number === totalRounds ? "championship-round" : "compact-round"}" style="left:${xForColumn(roundIndex)}px;width:${cardWidth}px"><header><span>Round ${number}</span><strong>${knockoutRoundLabel(number)}</strong></header><div class="bracket-matches">${matches}</div></section>`,
      );
    }
  } else {
    for (let roundIndex = 0; roundIndex < totalRounds - 1; roundIndex++)
      columns.push(columnMarkup(roundIndex, "left"));
    columns.push(columnMarkup(totalRounds - 1, "final"));
    for (let roundIndex = totalRounds - 2; roundIndex >= 0; roundIndex--)
      columns.push(columnMarkup(roundIndex, "right"));
  }

  return `<section class="bracket-panel" aria-label="Knockout bracket"><div class="bracket-panel-head"><div><span class="eyebrow">Tournament tree</span><h3>Bracket overview</h3></div><span class="pill">${state.players.filter((profile) => profile.active).length} players · ${totalRounds} rounds</span></div><div class="bracket-scroll"><div class="knockout-bracket ${compact ? "compact-bracket" : "mirrored-bracket"}" style="width:${width}px;height:${height}px"><svg class="bracket-connectors" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${connectors.join("")}</svg>${columns.join("")}</div></div>${compact ? "" : '<p class="bracket-scroll-hint">Scroll horizontally to explore both sides of the bracket.</p>'}</section>`;
}

function roundRobinTableView() {
  const participants = state.players
    .filter((profile) => profile.active)
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  if (participants.length < 2) return "";

  const stats = new Map(
    standings(state.players, state.rounds).map((entry) => [
      entry.player.id,
      entry,
    ]),
  );
  const games = state.rounds.flatMap((round) =>
    round.pairings.map((game) => ({ round: round.number, game })),
  );
  const scoreFor = (id: string, game: Round["pairings"][number]) => {
    if (!game.result) return "·";
    const isWhite = game.whiteId === id;
    if (game.result === "½-½") return "½";
    if (game.result === "BYE") return "1";
    const won =
      (isWhite && ["1-0", "1F-0F"].includes(game.result)) ||
      (!isWhite && ["0-1", "0F-1F"].includes(game.result));
    const forfeit = game.result.includes("F");
    return `${won ? "1" : "0"}${forfeit ? "F" : ""}`;
  };

  const rows = participants
    .map((profile, rowIndex) => {
      const entry = stats.get(profile.id);
      const cells = participants
        .map((opponent, columnIndex) => {
          if (profile.id === opponent.id)
            return '<td class="rr-self" aria-label="Same player">×</td>';
          const meetings = games.filter(
            ({ game }) =>
              game.blackId &&
              ((game.whiteId === profile.id && game.blackId === opponent.id) ||
                (game.whiteId === opponent.id && game.blackId === profile.id)),
          );
          if (!meetings.length)
            return `<td class="rr-unscheduled" aria-label="Not yet scheduled">—</td>`;
          const latestRound = meetings.at(-1)!.round;
          const current = latestRound === currentRound()?.number;
          const color =
            meetings.at(-1)!.game.whiteId === profile.id ? "white" : "black";
          const label = meetings
            .map(
              ({ round, game }) =>
                `Round ${round}: ${scoreFor(profile.id, game)} as ${game.whiteId === profile.id ? "White" : "Black"}`,
            )
            .join(" · ");
          return `<td class="rr-result rr-${color} ${current ? "rr-current" : ""}" title="${h(label)}">${meetings.map(({ game }) => scoreFor(profile.id, game)).join("/")}</td>`;
        })
        .join("");
      return `<tr><td class="rr-seed mono">${rowIndex + 1}</td><td class="rr-player"><span>${countryFlag(profile.country)}</span><button data-player="${profile.id}">${h(profile.name)}</button><small>${profile.rating}</small></td>${cells}<td class="rr-points">${(entry?.points || 0).toFixed(1)}</td><td class="rr-rank">${entry?.rank || "—"}</td></tr>`;
    })
    .join("");

  return `<section class="round-robin-panel" aria-label="Round Robin crosstable"><div class="bracket-panel-head"><div><span class="eyebrow">All-play-all matrix</span><h3>Round Robin table</h3></div><span class="pill">${participants.length} players · ${state.rounds.length}/${state.tournament.totalRounds} rounds</span></div><div class="round-robin-scroll"><table class="round-robin-table"><thead><tr><th>No.</th><th>Player</th>${participants.map((_, index) => `<th aria-label="Player ${index + 1}">${index + 1}</th>`).join("")}<th>Pts.</th><th>Rk.</th></tr></thead><tbody>${rows}</tbody></table></div><div class="rr-legend"><span><i class="rr-white"></i> Played as White</span><span><i class="rr-black"></i> Played as Black</span><span><i class="rr-current"></i> Current round</span></div></section>`;
}

function pairingsView() {
  const r = currentRound();
  const knockout = state.tournament.type === "Knockout";
  const roundRobin = state.tournament.type === "Round Robin";
  const title = r
    ? knockout
      ? `${knockoutRoundLabel(r.number)} bracket`
      : `Round ${r.number} pairings`
    : knockout
      ? "Knockout bracket"
      : "Pairings";
  const resultHelp = knockout
    ? "Results save instantly. Knockout games require a decisive result. Review every result before confirming the next stage."
    : "Results save instantly. When every board is complete, review the results and confirm before creating the next round.";
  const canAdvance =
    Boolean(r && isComplete(r)) &&
    state.rounds.length < state.tournament.totalRounds &&
    !state.tournament.finished;
  const emptyState =
    state.tournament.type === "Team"
      ? empty(
          "♞",
          "Team pairing is not available yet",
          "Choose Swiss, Round Robin, or Knockout in tournament settings.",
          "Manage players",
          "go-players",
        )
      : empty(
          "♞",
          "Add players to begin",
          "At least two active players are required. Pairings will be generated automatically.",
          "Manage players",
          "go-players",
        );
  return `<div class="section-head"><div><span class="eyebrow">${knockout ? "Single elimination" : "Tournament room"}</span><h2>${title}</h2></div><div class="toolbar">${canEndTournament() ? `<button class="btn gold" data-action="end-tournament">${icon("flag")} End tournament</button>` : ""}${state.tournament.finished ? `<span class="pill final-status">${icon("trophy", 12)} Final</span>` : ""}</div></div>${r ? `${knockout ? knockoutBracketView() : roundRobin ? roundRobinTableView() : ""}<div class="current-round-label"><span class="eyebrow">${knockout ? `${knockoutRoundLabel(r.number)} controls` : `Round ${r.number}`}</span><h3>${knockout ? "Enter decisive results" : "Enter results"}</h3></div><div class="card">${r.pairings.map((g) => board(g, r)).join("")}</div>${canAdvance ? `<section class="round-complete-prompt" aria-live="polite"><div><span class="eyebrow">Results complete</span><h3>Review Round ${r.number} before continuing</h3><p>Pairings for Round ${r.number + 1} will only be created after your confirmation.</p></div><button class="btn primary" data-action="review-next-round">${icon("arrow-right")} Continue to Round ${r.number + 1}</button></section>` : ""}<p class="muted" style="font-size:12px;margin-top:12px">${resultHelp}</p>` : emptyState}`;
}

function board(g: Round["pairings"][number], r: Round) {
  const w = player(g.whiteId),
    b = player(g.blackId);
  if (!b)
    return `<div class="board-card"><span class="board-no">B${g.board}</span><div class="player-side"><span class="piece white">♔</span><b>${h(w?.name)}</b></div><div class="result-buttons"><button class="selected" disabled>${state.tournament.type === "Knockout" ? "BYE · Advances" : "BYE · 1 point"}</button></div><div></div></div>`;
  const choices: [NonNullable<GameResult>, string][] = [
    ["1-0", "1–0"],
    ...(state.tournament.type === "Knockout"
      ? []
      : ([["½-½", "½–½"]] as [NonNullable<GameResult>, string][])),
    ["0-1", "0–1"],
    ["1F-0F", "W/F"],
    ["0F-1F", "F/W"],
  ];
  return `<div class="board-card"><span class="board-no">B${g.board}</span><div class="player-side"><span class="piece white">♔</span><span><b>${h(w?.name)}</b><small class="muted" style="display:block">${w?.rating}</small></span></div><div class="result-buttons" aria-label="Result for board ${g.board}">${choices.map(([v, l]) => `<button data-result="${v}" data-game="${g.id}" ${!r.locked || state.tournament.finished ? "disabled" : ""} class="${g.result === v ? "selected" : ""}" title="${v.includes("F") ? "Forfeit result" : v}">${l}</button>`).join("")}</div><div class="player-side" style="justify-content:flex-end;text-align:right"><span><b>${h(b.name)}</b><small class="muted" style="display:block">${b.rating}</small></span><span class="piece black">♚</span></div></div>`;
}
function federationCode(country: string): string {
  const value = country.trim();
  if (!value) return "—";
  const aliases: Record<string, string> = {
    philippines: "PHI",
    philippine: "PHI",
    ph: "PHI",
    usa: "USA",
    "united states": "USA",
    india: "IND",
    indonesia: "INA",
    malaysia: "MAS",
    singapore: "SGP",
  };
  return aliases[value.toLowerCase()] || value.toUpperCase().slice(0, 3);
}

function countryFlag(country: string): string {
  const federation = federationCode(country);
  const iso2 = iso2ForFederation(federation);
  const name = federationName(federation);
  return iso2
    ? `<img class="federation-flag" src="${import.meta.env.BASE_URL}flags/${iso2.toLowerCase()}.svg" alt="${h(name)} flag" title="${h(name)}" loading="lazy">`
    : `<span class="federation-flag federation-neutral" role="img" aria-label="${h(name || "Neutral federation")}">♟</span>`;
}

function rankingHeading(): string {
  const round = currentRound()?.number || 0;
  const missing =
    currentRound()?.pairings.filter((game) => game.result === null).length || 0;
  if (state.tournament.finished) return `Final Rank after Round ${round}`;
  if (round === 0) return "Starting Rank";
  return `Rank after Round ${round}${missing ? ` (${missing} results missing)` : ""}`;
}

function standingsTable(
  rows = standings(state.players, state.rounds),
  includeReportHeading = false,
) {
  const details = `${state.tournament.name} · ${state.tournament.venue || "Venue not set"} · ${state.tournament.date} · ${state.tournament.type} · ${state.tournament.timeControl}`;
  return `<section class="ranking-report" ${includeReportHeading ? 'id="export-area"' : ""}>${
    includeReportHeading
      ? `<header class="ranking-heading"><span class="eyebrow">Official tournament report</span><h3>${h(rankingHeading())}</h3><p>${h(details)}</p></header>`
      : ""
  }<div class="table-wrap"><table class="ranking-table"><thead><tr><th>Rk.</th><th>SNo</th><th>Name</th><th>Federation</th><th>Rtg</th><th>Club/City</th><th>Pts.</th><th title="Buchholz">TB1</th><th title="Buchholz Cut 1">TB2</th><th title="Sonneborn-Berger">TB3</th></tr></thead><tbody>${rows
    .map((entry) => {
      const startNumber =
        state.players.findIndex((profile) => profile.id === entry.player.id) +
        1;
      return `<tr class="medal-${entry.rank}"><td class="rank">${entry.rank}</td><td class="mono">${startNumber}</td><td><button class="ranking-name" data-player="${entry.player.id}">${h(entry.player.name)}</button></td><td class="flag-cell">${countryFlag(entry.player.country)}</td><td class="mono">${entry.player.rating || 0}</td><td>${h(entry.player.club || "—")}</td><td class="score">${entry.points.toFixed(1)}</td><td>${entry.buchholz.toFixed(1)}</td><td>${entry.buchholzCut.toFixed(1)}</td><td>${entry.sonneborn.toFixed(1)}</td></tr>`;
    })
    .join("")}</tbody></table></div></section>`;
}
function standingsView() {
  const rows = standings(state.players, state.rounds);
  const final = state.tournament.finished;
  const podium = final
    ? `<section class="final-banner"><span class="eyebrow">Official final results</span><h2>${h(state.tournament.name)}</h2><div class="podium">${rows
        .slice(0, 3)
        .map(
          (entry, index) =>
            `<article class="podium-${index + 1}"><span>${["♛", "♜", "♝"][index]}</span><small>${["Champion", "Runner-up", "Third place"][index]}</small><b>${h(entry.player.name)}</b><strong>${entry.points.toFixed(1)} pts</strong></article>`,
        )
        .join("")}</div></section>`
    : "";
  return `${podium}<div class="section-head"><div><span class="eyebrow">${final ? "Certified results" : "Live leaderboard"}</span><h2>${final ? "Final Rank" : "Standings"}</h2></div><div class="toolbar">${canEndTournament() ? `<button class="btn gold" data-action="end-tournament">${icon("flag")} End tournament</button>` : ""}<button class="btn" data-action="projector">${icon("presentation")} Projector</button><button class="btn" data-export="pdf-standings">${icon("printer")} PDF</button></div></div>${rows.length ? standingsTable(rows, true) : empty("♛", "Standings await", "Add players and complete games to see live rankings.", "Manage players", "go-players")}`;
}
function historyView() {
  const n = selectedRound || currentRound()?.number;
  const r = state.rounds.find((x) => x.number === n);
  return `<div class="section-head"><div><span class="eyebrow">Archive</span><h2>Round history</h2></div><div class="toolbar">${r ? `<button class="btn" data-export-round="${r.number}">${icon("file-down")} Round PGN</button>` : ""}${state.rounds.length && !state.tournament.finished ? `<button class="btn danger" data-action="undo-round">${icon("undo-2")} Undo last round</button>` : ""}</div></div><div class="round-tabs">${state.rounds.map((x) => `<button class="btn ${x.number === n ? "primary" : ""}" data-round="${x.number}">Round ${x.number} · ${isComplete(x) ? "Complete" : "Open"}</button>`).join("")}</div><div style="height:14px"></div>${r ? `<div class="card">${r.pairings.map((g) => board(g, r)).join("")}</div>${!isComplete(r) && r !== currentRound() ? `<button class="btn" data-action="reopen-round" data-round="${r.number}" style="margin-top:12px">Reopen unfinished round</button>` : ""}` : empty("♜", "No rounds yet", "Round pairings and results will remain available here.", "Generate first round", "generate")}`;
}
function poster() {
  const rows = standings(state.players, state.rounds).slice(0, 12);
  return `<div class="poster" id="poster"><span class="eyebrow">Official live standings</span><h1>${h(state.tournament.name)}</h1><p style="font-size:25px;color:#9eb7ac">${h(state.tournament.venue)} · ${h(state.tournament.date)} · ${h(state.tournament.type)} · ${h(state.tournament.timeControl)} · Round ${state.rounds.length}</p>${standingsTable(rows)}<p style="position:absolute;bottom:60px">Generated with Chest-Tournament Manager</p></div>`;
}
// -----------------------------------------------------------------------------
// Dialog and sheet renderers
// -----------------------------------------------------------------------------

function modalView() {
  if (!modal && !selectedPlayer) return "";
  if (selectedPlayer) return profileModal(selectedPlayer);
  if (modal === "player" || modal.startsWith("player:")) return playerForm();
  if (modal === "tournament") return tournamentForm();
  if (modal === "new") return confirmNew();
  if (modal === "finish") return finishTournamentModal();
  if (modal === "advance-round") return advanceRoundModal();
  if (modal === "tournaments") return tournamentChooser();
  if (modal === "appearance") return appearanceSettings();
  return "";
}

function appearanceSettings() {
  const choices: Array<{
    id: AppTheme;
    name: string;
    description: string;
  }> = [
    {
      id: "dark",
      name: "Dark",
      description: "The default charcoal, emerald, and gold tournament theme.",
    },
    {
      id: "light",
      name: "Light",
      description: "A bright, high-contrast workspace for daylight venues.",
    },
    {
      id: "criterion",
      name: "The Criterion",
      description:
        "Deep society green and warm ivory inspired by classic chess print.",
    },
  ];
  return `<div class="modal-backdrop"><section class="modal appearance-modal" role="dialog" aria-modal="true" aria-labelledby="appearance-title" data-modal><div class="modal-head"><div><span class="eyebrow">Application settings</span><h2 id="appearance-title">Choose a theme</h2><p class="muted">Your choice is saved on this device and applies to every tournament.</p></div><button class="icon-btn" data-action="close-modal" aria-label="Close">${icon("x")}</button></div><div class="theme-options" role="radiogroup" aria-label="Color theme">${choices
    .map(
      (choice) =>
        `<button type="button" class="theme-option ${activeTheme === choice.id ? "active" : ""}" data-theme-choice="${choice.id}" role="radio" aria-checked="${activeTheme === choice.id}"><span class="theme-preview theme-preview-${choice.id}" aria-hidden="true"><i></i><b></b><em></em></span><span class="theme-copy"><strong>${choice.name}</strong><small>${choice.description}</small><span class="theme-select-label"><span class="theme-radio" aria-hidden="true">${activeTheme === choice.id ? icon("check", 13) : ""}</span>${activeTheme === choice.id ? "Current theme" : "Select theme"}</span></span></button>`,
    )
    .join("")}</div></section></div>`;
}

function playerForm() {
  const editing = modal.startsWith("player:");
  const p = editing ? player(modal.split(":")[1]) : undefined;
  const age = p?.age || "";
  const category = p?.ageCategory || categoryForAge(Number(age));

  return `<div class="modal-backdrop">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal>
      <div class="modal-head">
        <div><span class="eyebrow">Reusable player directory</span><h2 id="modal-title">${p ? "Edit player profile" : "Create player profile"}</h2></div>
        <button class="icon-btn" data-action="close-modal" aria-label="Close">${icon("x")}</button>
      </div>
      <form id="player-form">
        <input type="hidden" name="id" value="${p?.id || ""}">
        <div class="avatar-editor">
          <div id="avatar-preview">${p ? avatarMarkup({ ...p, avatar: pendingAvatar }, true) : pendingAvatar ? `<span class="avatar avatar-large"><img src="${h(pendingAvatar)}" alt=""></span>` : `<span class="avatar avatar-large">${icon("user", 28)}</span>`}</div>
          <div><b>Profile picture</b><small>Optional · JPG, PNG, or WebP</small><div class="toolbar"><label class="btn file-button">${icon("image-plus")} Choose photo<input id="player-avatar" type="file" accept="image/jpeg,image/png,image/webp" hidden></label><button id="remove-avatar-btn" type="button" class="btn danger" data-action="remove-avatar" ${pendingAvatar ? "" : "hidden"}>Remove</button></div></div>
        </div>
        <div class="form-grid">
          <div class="field full-field"><label>Full name *</label><input name="name" required autofocus autocomplete="name" value="${h(p?.name || "")}"></div>
          <div class="field"><label>Rating *</label><input name="rating" type="number" inputmode="numeric" min="0" max="3500" required value="${p?.rating ?? ""}"></div>
          <div class="field"><label>Age *</label><input id="player-age" name="age" type="number" inputmode="numeric" min="1" max="120" required value="${age}"></div>
          <div class="field"><label>Age category</label><output id="age-category" class="derived-field" aria-live="polite">${h(category)}</output><small>Calculated automatically from age</small></div>
          <div class="field"><label>Club <span class="optional">Optional</span></label><input name="club" value="${h(p?.club || "")}"></div>
          <div class="field"><label>Federation <span class="optional">Optional</span></label><div class="federation-picker"><span id="federation-selected-flag" class="selected-federation-flag">${p?.country ? countryFlag(p.country) : icon("flag", 18)}</span><select id="player-federation" name="country"><option value="">No federation</option>${FEDERATIONS.map((federation) => `<option value="${federation.code}" ${federation.code === federationCode(p?.country || "") ? "selected" : ""}>${federation.name}</option>`).join("")}</select></div></div>
          <div class="field"><label>FIDE ID <span class="optional">Optional</span></label><input name="fideId" inputmode="numeric" value="${h(p?.fideId || "")}"></div>
        </div>
        ${!p ? `<label class="registration-option"><input type="checkbox" name="registerCurrent" checked><span><b>Add to ${h(state.tournament.name)}</b><small>The profile is saved globally and registered for this tournament.</small></span></label>` : ""}
        <div class="toolbar" style="justify-content:flex-end;margin-top:22px">
          <button type="button" class="btn" data-action="close-modal">Cancel</button>
          <button class="btn primary" type="button" data-action="save-player-profile">${p ? "Save profile" : "Create profile"}</button>
        </div>
      </form>
    </section>
  </div>`;
}
function tournamentForm() {
  const t = state.tournament;
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><h2>Tournament settings</h2><button class="icon-btn" data-action="close-modal">${icon("x")}</button></div><form id="tournament-form"><div class="form-grid"><div class="field"><label>Tournament name *</label><input name="name" required value="${h(t.name)}"></div><div class="field"><label>Venue</label><input name="venue" value="${h(t.venue)}"></div><div class="field"><label>Organizer</label><input name="organizer" value="${h(t.organizer)}"></div><div class="field"><label>Date</label><input name="date" type="date" value="${t.date}"></div><div class="field"><label>Time control</label><input name="timeControl" value="${h(t.timeControl)}"></div><div class="field"><label>Number of rounds</label><input name="totalRounds" type="number" min="1" max="30" value="${t.totalRounds}"><small>Calculated automatically from the field size for Knockout.</small></div><div class="field"><label>Tournament type</label><select name="type">${["Swiss System", "Round Robin", "Knockout", "Team"].map((x) => `<option ${t.type === x ? "selected" : ""}>${x}</option>`).join("")}</select></div></div><div class="toolbar" style="justify-content:flex-end;margin-top:22px"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save tournament</button></div></form></section></div>`;
}
function confirmNew() {
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" data-modal><h2>Create another tournament?</h2><p class="muted">Your current tournament remains safely stored in this browser. You can switch between events at any time.</p><div class="toolbar"><button class="btn primary" data-action="confirm-new">Create tournament</button><button class="btn" data-action="close-modal">Cancel</button></div></section></div>`;
}

function advanceRoundModal() {
  const round = currentRound();
  if (!round || !isComplete(round)) return "";
  return `<div class="modal-backdrop"><section class="modal advance-round-modal" role="dialog" aria-modal="true" aria-labelledby="advance-round-title" data-modal><div class="modal-head"><div><span class="eyebrow">Confirm completed results</span><h2 id="advance-round-title">Continue to Round ${round.number + 1}?</h2></div><button class="icon-btn" data-action="close-modal" aria-label="Close">${icon("x")}</button></div><p class="muted">Review the results for every board before continuing. Confirming will create the next round using the current standings and tie-break data.</p><div class="round-confirm-summary"><span><b>${round.pairings.length}</b> boards</span><span><b>${round.pairings.filter((game) => game.result !== null).length}</b> results entered</span></div><div class="toolbar" style="justify-content:flex-end;margin-top:22px"><button class="btn" data-action="close-modal">Review results</button><button class="btn primary" data-action="confirm-next-round">${icon("arrow-right")} Create Round ${round.number + 1}</button></div></section></div>`;
}

function finishTournamentModal() {
  const leaders = standings(state.players, state.rounds).slice(0, 3);
  return `<div class="modal-backdrop"><section class="modal finish-modal" role="dialog" aria-modal="true" aria-labelledby="finish-title" data-modal><div class="finish-icon">♛</div><span class="eyebrow">Final round complete</span><h2 id="finish-title">End ${h(state.tournament.name)}?</h2><p class="muted">This certifies the current standings as the final rankings and locks result entry. Tournament details will remain available for export.</p><div class="finish-preview">${leaders.map((entry, index) => `<div class="finish-rank-${index + 1}"><span>${entry.rank}</span><b>${h(entry.player.name)}</b><strong>${entry.points.toFixed(1)}</strong></div>`).join("")}</div><div class="toolbar" style="justify-content:center;margin-top:22px"><button class="btn gold" data-action="confirm-end-tournament">${icon("trophy")} Publish final rankings</button><button class="btn" data-action="close-modal">Not yet</button></div></section></div>`;
}

/** Render the local tournament library. No tournament data leaves the browser. */
function tournamentChooser() {
  const events = storage.list();
  return `<div class="modal-backdrop"><section class="modal tournament-library" role="dialog" aria-modal="true" aria-labelledby="library-title" data-modal><div class="modal-head"><div><span class="eyebrow">Local library</span><h2 id="library-title">Choose tournament</h2></div><button class="icon-btn" data-action="close-modal" aria-label="Close">${icon("x")}</button></div><div class="event-list">${events
    .map((event) => {
      const t = event.tournament;
      const active = t.id === state.tournament.id;
      const completed = event.rounds
        .flatMap((r) => r.pairings)
        .filter((g) => g.result !== null).length;
      return `<article class="event-card ${active ? "active" : ""}"><button class="event-main" data-switch-tournament="${t.id}" ${active ? 'aria-current="true"' : ""}><span class="event-mark">${t.finished ? "♛" : "♞"}</span><span><b>${h(t.name)}</b><small>${h(t.venue)} · ${h(t.date)}</small><small>${event.players.length} players · ${event.rounds.length}/${t.totalRounds} rounds · ${completed} results</small></span>${active ? '<span class="pill">Current</span>' : icon("chevron-right")}</button><button class="icon-btn event-delete" data-delete-tournament="${t.id}" aria-label="Delete ${h(t.name)}" ${events.length === 1 ? "disabled" : ""}>${icon("trash-2")}</button></article>`;
    })
    .join(
      "",
    )}</div><div class="toolbar" style="margin-top:18px"><button class="btn primary" data-action="new-from-library">${icon("plus")} New tournament</button><button class="btn" data-action="restore">${icon("upload")} Import backup</button></div></section></div>`;
}
function profileModal(id: string) {
  const s = standings(state.players, state.rounds).find(
    (x) => x.player.id === id,
  );
  const p = player(id);
  if (!p) return "";
  const games = state.rounds.flatMap((r) =>
    r.pairings
      .filter((g) => g.whiteId === id || g.blackId === id)
      .map((g) => ({ r: r.number, g })),
  );
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><div style="display:flex;gap:14px">${avatarMarkup(p, true)}<div><h2 style="margin-bottom:2px">${h(p.name)}</h2><span class="muted">${p.rating} · Age ${p.age || "—"} · ${h(p.ageCategory || categoryForAge(p.age))} · ${p.club ? h(p.club) : p.country ? countryFlag(p.country) : "Independent"}</span></div></div><button class="icon-btn" data-action="close-modal">${icon("x")}</button></div><div class="metrics" style="grid-template-columns:repeat(4,1fr)"><div class="metric"><b>${s?.points.toFixed(1) || "0.0"}</b><span>Points</span></div><div class="metric"><b>${s?.wins || 0}</b><span>Wins</span></div><div class="metric"><b>${s?.draws || 0}</b><span>Draws</span></div><div class="metric"><b>${s?.losses || 0}</b><span>Losses</span></div></div><div class="timeline player-results">${
    games.length
      ? games
          .map(({ r, g }) => {
            const isWhite = g.whiteId === id,
              opp = player(isWhite ? g.blackId : g.whiteId);
            return `<div class="timeline-item"><b>Round ${r} · ${isWhite ? "White" : g.blackId ? "Black" : "Bye"}</b><div class="muted">${opp ? `vs ${h(opp.name)}` : "Bye"} · ${g.result || "Pending"}</div></div>`;
          })
          .join("")
      : '<p class="muted">No games played yet.</p>'
  }</div></section></div>`;
}
function projectorView() {
  const labels = [
    "Live Standings",
    `Round ${state.rounds.length} Pairings`,
    "Tournament Overview",
  ];
  let body = "";
  if (projectorSlide === 0)
    body = standingsTable(standings(state.players, state.rounds).slice(0, 12));
  else if (projectorSlide === 1)
    body = currentRound()
      ? `<div class="card">${currentRound()!
          .pairings.map((g) => board(g, currentRound()!))
          .join("")}</div>`
      : "<p>No pairings yet.</p>";
  else
    body = `${metrics()}<div class="hero"><h2>${h(state.tournament.name)}</h2><p>${h(state.tournament.venue)} · ${h(state.tournament.date)}</p></div>`;
  return `<section class="projector"><button class="btn close-projector" data-action="projector-close">${icon("x")} Exit</button><span class="eyebrow">${h(state.tournament.name)}</span><h1>${labels[projectorSlide]}</h1><div style="height:3vh"></div>${body}</section>`;
}
// -----------------------------------------------------------------------------
// Render lifecycle and progressive interaction enhancement
// -----------------------------------------------------------------------------

/** Add progressive interaction behavior to freshly rendered markup. */
function enhanceRenderedUi(): void {
  createIcons({ icons });

  // Icon-only controls use the existing accessible name as their tooltip.
  document
    .querySelectorAll<HTMLElement>(".icon-btn[aria-label]:not([data-tooltip])")
    .forEach((button) => {
      const label = button.getAttribute("aria-label");
      if (label) button.dataset.tooltip = label;
    });
  document.querySelectorAll<HTMLElement>("[title]").forEach((element) => {
    const label = element.getAttribute("title");
    if (label) element.dataset.tooltip = label;
    element.removeAttribute("title");
  });

  const bracketScroller =
    document.querySelector<HTMLElement>(".bracket-scroll");
  if (bracketScroller)
    requestAnimationFrame(() => {
      bracketScroller.scrollLeft =
        (bracketScroller.scrollWidth - bracketScroller.clientWidth) / 2;
    });

  const dialog = document.querySelector<HTMLElement>("[role='dialog']");
  document.body.classList.toggle("modal-open", Boolean(dialog));
  if (dialog) {
    requestAnimationFrame(() => {
      const preferred = dialog.querySelector<HTMLElement>("[autofocus]");
      const fallback = dialog.querySelector<HTMLElement>(
        "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      (preferred || fallback)?.focus();
    });
  }
}

function render() {
  if (!hasTournament) {
    app.innerHTML = creationPage();
    enhanceRenderedUi();
    return;
  }
  let content = dashboard();
  if (state.view === "players") content = playersView();
  if (state.view === "pairings") content = pairingsView();
  if (state.view === "standings") content = standingsView();
  if (state.view === "history") content = historyView();
  app.innerHTML = shell(content);
  enhanceRenderedUi();
}

// -----------------------------------------------------------------------------
// Tournament commands
// -----------------------------------------------------------------------------

function generatePairings(rounds: Round[]): Round["pairings"] {
  if (state.tournament.type === "Round Robin")
    return generateRoundRobin(state.players, rounds);
  if (state.tournament.type === "Knockout")
    return generateKnockout(state.players, rounds);
  return generateSwiss(state.players, rounds);
}

function prepareAutomaticRound(allowAdvance = false): boolean {
  if (state.tournament.finished || state.tournament.type === "Team")
    return false;
  const active = state.players.filter((player) => player.active);
  if (active.length < 2) return false;

  let changed = false;
  if (state.tournament.type === "Knockout" && !state.rounds.length) {
    state.tournament.totalRounds = knockoutRoundCount(active.length);
    changed = true;
  }
  const last = currentRound();
  if (last && !last.locked) {
    last.locked = true;
    last.pairings.forEach((game) => (game.locked = true));
    changed = true;
  }
  if (last && !isComplete(last)) return changed;
  // Completed rounds remain open for review. Advancing requires an explicit
  // organizer confirmation so an accidental final result cannot create the
  // next round immediately.
  if (last && !allowAdvance) return changed;
  if (
    state.tournament.type === "Knockout" &&
    last?.pairings.some((game) => game.result === "½-½")
  )
    return changed;
  if (state.rounds.length >= state.tournament.totalRounds) return changed;

  const pairings = generatePairings(state.rounds).map((game) => ({
    ...game,
    locked: true,
  }));
  state.rounds.push({
    number: state.rounds.length + 1,
    pairings,
    locked: true,
    completed: pairings.every((game) => game.result !== null),
    createdAt: new Date().toISOString(),
  });
  return true;
}

function prepareAndPersistAutomaticRound(): void {
  if (!prepareAutomaticRound()) return;
  try {
    storage.save(state);
  } catch (error) {
    console.error(error);
    toast("The automatic round could not be saved.", "error");
  }
}

function submitPlayer(form: HTMLFormElement) {
  const fd = new FormData(form),
    id = String(fd.get("id") || "");
  const age = Number(fd.get("age"));
  const registrationIndex = state.players.findIndex(
    (profile) => profile.id === id,
  );
  const data: Player = {
    id: id || uid(),
    name: String(fd.get("name")),
    rating: Number(fd.get("rating")),
    age,
    club: String(fd.get("club") || ""),
    country: String(fd.get("country") || ""),
    fideId: String(fd.get("fideId") || ""),
    // Category is always derived; user input can never make it inconsistent.
    ageCategory: categoryForAge(age),
    avatar: pendingAvatar || undefined,
    active:
      registrationIndex >= 0 ? state.players[registrationIndex].active : true,
  };

  // Profiles belong to the directory. Tournament registration is a separate,
  // explicit action so the same person can be reused across many events.
  const previousPlayers = [...state.players];
  const registerWithCurrentTournament = fd.get("registerCurrent") === "on";
  try {
    storage.savePlayer(data);
    if (registrationIndex >= 0) {
      state.players[registrationIndex] = { ...data };
      storage.save(state);
    } else if (registerWithCurrentTournament) {
      state.players.push({ ...data, active: true });
      storage.save(state);
    }
    modal = "";
    toast(
      id
        ? "Player profile updated"
        : registerWithCurrentTournament
          ? "Player saved and added to the tournament"
          : "Player profile saved",
      "success",
    );
    render();
  } catch (error) {
    console.error("Unable to save player profile", error);
    state.players = previousPlayers;
    toast(
      "The player could not be saved. Check browser storage access.",
      "error",
    );
  }
}
function submitTournament(form: HTMLFormElement) {
  if (tournamentStarted()) {
    toast("Tournament settings cannot change after Round 1 starts.", "error");
    return;
  }
  const f = new FormData(form);
  state.tournament = {
    ...state.tournament,
    name: String(f.get("name")),
    venue: String(f.get("venue")),
    organizer: String(f.get("organizer")),
    date: String(f.get("date")),
    timeControl: String(f.get("timeControl")),
    totalRounds: Number(f.get("totalRounds")),
    type: String(f.get("type")) as Tournament["type"],
  };
  hasTournament = true;
  draftingNewTournament = false;
  modal = "";
  save("Tournament saved");
  render();
}
async function doExport(type: string) {
  exportOpen = false;
  toast("Preparing export…");
  try {
    if (type === "pgn")
      download(
        new Blob([pgn(state)], { type: "application/x-chess-pgn" }),
        `${slug(state.tournament.name)}.pgn`,
      );
    else if (type === "pdf-standings") makePdf(state, "standings");
    else if (type === "pdf-pairings") makePdf(state, "pairings");
    else if (type === "pdf-players") makePdf(state, "players");
    else if (type === "png" || type === "jpg")
      await makeImage(
        document.querySelector("#poster")!,
        type,
        type === "png" ? "1080x1350" : "1920x1080",
      );
    else if (type === "zip")
      await makeZip(state, document.querySelector("#poster")!);
    toast("Export ready");
  } catch (e) {
    console.error(e);
    toast("Could not create export", "error");
  }
  render();
}

// -----------------------------------------------------------------------------
// Delegated DOM events
// -----------------------------------------------------------------------------

app.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains("modal-backdrop")) {
    requestModalClose();
    return;
  }
  const el = target.closest<HTMLElement>(
    "[data-action],[data-view],[data-player],[data-edit-player],[data-delete-player],[data-add-to-tournament],[data-remove-from-tournament],[data-switch-tournament],[data-delete-tournament],[data-result],[data-round],[data-export],[data-export-round],[data-theme-choice]",
  );
  if (!el) return;
  if (el.dataset.themeChoice) {
    const theme = el.dataset.themeChoice as AppTheme;
    if (THEMES.includes(theme)) {
      applyTheme(theme);
      state.view = "dashboard";
      modal = "";
      render();
      document.querySelector<HTMLElement>("#main")?.focus();
    }
    return;
  }
  // The backdrop closes a dialog only when it is clicked directly. Without
  // this guard, ordinary clicks inside a modal could bubble to its backdrop.
  if (el.classList.contains("modal-backdrop") && target !== el) return;
  const opensDialog =
    Boolean(el.dataset.player || el.dataset.editPlayer) ||
    [
      "add-player",
      "app-settings",
      "edit-tournament",
      "choose-tournament",
      "new-tournament",
      "new-from-library",
      "end-tournament",
    ].includes(el.dataset.action || "");
  if (opensDialog) lastFocusedElement = document.activeElement as HTMLElement;
  const view = el.dataset.view;
  if (view) {
    state.view = view;
    exportOpen = false;
    if (view === "pairings") prepareAndPersistAutomaticRound();
    render();
    return;
  }
  if (el.dataset.player) {
    selectedPlayer = el.dataset.player;
    render();
    return;
  }
  if (el.dataset.switchTournament) {
    const selected = storage.select(el.dataset.switchTournament);
    if (selected) {
      state = selected;
      state.view = "dashboard";
      selectedRound = null;
      modal = "";
      toast(`Opened ${state.tournament.name}`);
      render();
    }
    return;
  }
  if (el.dataset.deleteTournament) {
    const doomed = storage
      .list()
      .find((x) => x.tournament.id === el.dataset.deleteTournament);
    if (
      doomed &&
      confirm(`Delete ${doomed.tournament.name}? This cannot be undone.`)
    ) {
      storage.remove(doomed.tournament.id);
      if (doomed.tournament.id === state.tournament.id)
        state = storage.load() || emptyState();
      toast("Tournament deleted");
      render();
    }
    return;
  }
  if (el.dataset.addToTournament) {
    const profile = storage
      .listPlayers()
      .find((candidate) => candidate.id === el.dataset.addToTournament);
    if (profile && !state.players.some((entry) => entry.id === profile.id)) {
      state.players.push({ ...profile, active: true });
      save(`${profile.name} registered for ${state.tournament.name}`);
      render();
    }
    return;
  }
  if (el.dataset.removeFromTournament) {
    const id = el.dataset.removeFromTournament;
    const profile = player(id);
    const hasHistory = state.rounds.some((round) =>
      round.pairings.some(
        (pairing) => pairing.whiteId === id || pairing.blackId === id,
      ),
    );
    if (hasHistory) {
      toast(
        "This player has round history and cannot be unregistered.",
        "error",
      );
    } else {
      state.players = state.players.filter((entry) => entry.id !== id);
      save(`${profile?.name || "Player"} removed from this tournament`);
      render();
    }
    return;
  }
  if (el.dataset.editPlayer) {
    pendingAvatar = player(el.dataset.editPlayer)?.avatar || "";
    modal = `player:${el.dataset.editPlayer}`;
    render();
    return;
  }
  if (el.dataset.deletePlayer) {
    const profile = player(el.dataset.deletePlayer);
    if (profile && confirm(`Delete the profile for ${profile.name}?`)) {
      const removed = storage.removePlayer(profile.id);
      if (removed) {
        toast("Player profile deleted", "success");
        render();
      } else {
        toast(
          "Remove this player from every tournament before deleting the profile.",
          "error",
        );
      }
    }
    return;
  }
  if (el.dataset.result) {
    const r = currentRound(),
      g = r?.pairings.find((x) => x.id === el.dataset.game);
    if (r?.locked && g && !state.tournament.finished) {
      const result = el.dataset.result as GameResult;
      if (state.tournament.type === "Knockout" && result === "½-½") {
        toast("Knockout games require a decisive result.", "error");
        return;
      }
      optimisticUpdate(() => {
        g.result = result;
        r.completed = isComplete(r);
      });
    }
    return;
  }
  if (el.dataset.round) {
    selectedRound = Number(el.dataset.round);
    render();
    return;
  }
  if (el.dataset.export) {
    void doExport(el.dataset.export);
    return;
  }
  if (el.dataset.exportRound) {
    download(
      new Blob([pgn(state, Number(el.dataset.exportRound))], {
        type: "application/x-chess-pgn",
      }),
      `${slug(state.tournament.name)}-round-${el.dataset.exportRound}.pgn`,
    );
    return;
  }
  const a = el.dataset.action;
  if (a === "app-settings") {
    modal = "appearance";
    render();
  } else if (a === "add-player") {
    // Every Add Player entry point opens the same sheet and leaves the roster
    // visible underneath, so closing the form has a predictable destination.
    state.view = "players";
    modal = "player";
    render();
  } else if (a === "review-next-round") {
    const round = currentRound();
    if (!round || !isComplete(round)) return;
    modal = "advance-round";
    render();
  } else if (a === "confirm-next-round") {
    const nextNumber = state.rounds.length + 1;
    if (prepareAutomaticRound(true)) {
      modal = "";
      selectedRound = null;
      save(`Round ${nextNumber} created`);
      render();
    }
  } else if (a === "edit-tournament") {
    if (tournamentStarted()) {
      toast("Tournament settings are locked after Round 1 starts.", "info");
      return;
    }
    modal = "tournament";
    render();
  } else if (a === "choose-tournament") {
    modal = "tournaments";
    render();
  } else if (a === "new-tournament") {
    modal = "new";
    render();
  } else if (a === "new-from-library") {
    modal = "new";
    render();
  } else if (a === "confirm-new") {
    state = emptyState();
    draftingNewTournament = true;
    selectedRound = null;
    modal = "tournament";
    render();
  } else if (a === "end-tournament") {
    if (!canEndTournament()) {
      toast("Complete every game in the final round first.", "info");
      return;
    }
    modal = "finish";
    render();
  } else if (a === "confirm-end-tournament") {
    state.tournament.finished = true;
    state.view = "standings";
    modal = "";
    save("Tournament ended · final rankings published");
    render();
  } else if (a === "remove-avatar") {
    pendingAvatar = "";
    render();
  } else if (a === "save-player-profile") {
    const form = document.querySelector<HTMLFormElement>("#player-form");
    if (!form) {
      toast("The player form could not be found.", "error");
      return;
    }
    // Submit directly after validation instead of relying on requestSubmit(),
    // which is not implemented consistently in every embedded browser.
    if (!form.checkValidity()) {
      form.reportValidity();
      toast("Enter the required name, rating, and age fields.", "error");
      return;
    }
    submitPlayer(form);
  } else if (a === "close-modal") {
    requestModalClose();
  } else if (a === "sort") {
    sort = sort === "rating" ? "name" : "rating";
    render();
  } else if (a === "toggle-export") {
    exportOpen = !exportOpen;
    render();
  } else if (a === "backup") storage.backup(state);
  else if (a === "restore")
    document.querySelector<HTMLInputElement>("#restore-file")?.click();
  else if (a === "import-csv")
    document.querySelector<HTMLInputElement>("#csv-file")?.click();
  else if (a === "export-csv") {
    const csv = Papa.unparse(
      storage.listPlayers().map((p) => ({
        Name: p.name,
        Rating: p.rating,
        Age: p.age,
        "Age Category": p.ageCategory || categoryForAge(p.age),
        Club: p.club,
        Federation: p.country,
        "FIDE ID": p.fideId,
      })),
    );
    download(
      new Blob([csv], { type: "text/csv" }),
      `${slug(state.tournament.name)}-players.csv`,
    );
  } else if (a === "go-players") {
    state.view = "players";
    render();
  } else if (a === "undo-round") {
    if (state.tournament.finished) {
      toast("Finalized tournaments are locked.", "info");
      return;
    }
    if (confirm("Remove the latest round and all of its results?")) {
      state.rounds.pop();
      state.tournament.finished = false;
      selectedRound = null;
      save("Last round removed");
      render();
    }
  } else if (a === "reopen-round") {
    const r = state.rounds.find((x) => x.number === Number(el.dataset.round));
    if (r) {
      r.locked = true;
      state.view = "pairings";
      render();
    }
  } else if (a === "projector") {
    projector = true;
    projectorSlide = 0;
    projectorTimer = window.setInterval(() => {
      projectorSlide = (projectorSlide + 1) % 3;
      render();
    }, 9000);
    document.documentElement.requestFullscreen?.().catch(() => {});
    render();
  } else if (a === "projector-close") {
    projector = false;
    clearInterval(projectorTimer);
    document.exitFullscreen?.().catch(() => {});
    render();
  }
});
app.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  if (f.id === "player-form") submitPlayer(f);
  if (f.id === "tournament-form" || f.id === "creation-form")
    submitTournament(f);
});

// Native validation remains the source of truth, while the toast explains why
// a submit button appeared to do nothing when required data is missing.
app.addEventListener(
  "invalid",
  (e) => {
    const field = e.target as HTMLInputElement;
    field.setAttribute("aria-invalid", "true");
    toast("Enter the required name, rating, and age fields.", "error");
  },
  true,
);
app.addEventListener("input", (e) => {
  const editedField = e.target as HTMLInputElement;
  if (
    editedField.getAttribute("aria-invalid") === "true" &&
    editedField.validity.valid
  )
    editedField.removeAttribute("aria-invalid");
  const t = e.target as HTMLInputElement;
  if (t.id === "player-search") {
    search = t.value;
    const pos = t.selectionStart;
    render();
    const next = document.querySelector<HTMLInputElement>("#player-search");
    next?.focus();
    next?.setSelectionRange(pos, pos);
  }
  if (t.id === "player-age") {
    const output = document.querySelector<HTMLOutputElement>("#age-category");
    if (output) output.value = categoryForAge(Number(t.value));
  }
});
app.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "player-federation") {
    const preview = document.querySelector<HTMLElement>(
      "#federation-selected-flag",
    );
    if (preview)
      preview.innerHTML = t.value ? countryFlag(t.value) : icon("flag", 18);
  }
  if (t.id === "player-avatar" && t.files?.[0]) {
    const file = t.files[0];
    void compressAvatar(file)
      .then((avatar) => {
        pendingAvatar = avatar;
        const preview = document.querySelector<HTMLElement>("#avatar-preview");
        if (preview)
          preview.innerHTML = `<span class="avatar avatar-large"><img src="${h(avatar)}" alt="Selected profile picture"></span>`;
        document
          .querySelector<HTMLElement>("#remove-avatar-btn")
          ?.removeAttribute("hidden");
        toast("Profile picture ready to save", "success");
      })
      .catch((error) => {
        console.error(error);
        toast("Choose a valid image smaller than 10 MB.", "error");
      });
  }
  if (t.id === "csv-file" && t.files?.[0])
    Papa.parse<Record<string, string>>(t.files[0], {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        let imported = 0;
        for (const row of data) {
          const name = row.Name || row.name || row["Full Name"];
          const rating = Number(row.Rating || row.rating);
          const age = Number(row.Age || row.age);
          // Name, rating, and age follow the same validation rules as the form.
          if (
            !name ||
            !Number.isFinite(rating) ||
            !Number.isFinite(age) ||
            age < 1
          )
            continue;
          storage.savePlayer({
            id: uid(),
            name,
            rating,
            age,
            club: row.Club || row.club || "",
            country:
              row.Federation ||
              row.federation ||
              row.Country ||
              row.country ||
              "",
            fideId: row["FIDE ID"] || row.fideId || "",
            ageCategory: categoryForAge(age),
            active: true,
          });
          imported++;
        }
        save(
          `${imported} players imported${imported < data.length ? ` · ${data.length - imported} skipped` : ""}`,
        );
        render();
      },
    });
  if (t.id === "restore-file" && t.files?.[0]) {
    void storage
      .restore(t.files[0])
      .then((restored) => {
        if (!confirm("Import this backup as a tournament?")) return;
        state = restored;
        state.view = "dashboard";
        hasTournament = true;
        save("Backup restored");
        render();
      })
      .catch(() => toast("Invalid backup file", "error"));
  }
});
document.addEventListener("keydown", (e) => {
  const dialog = document.querySelector<HTMLElement>("[role='dialog']");

  // Keep keyboard focus inside an open modal sheet.
  if (e.key === "Tab" && dialog) {
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    );
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  if (e.key === "Escape") {
    if (dialog) {
      requestModalClose();
      return;
    }
    exportOpen = false;
    if (projector) {
      projector = false;
      clearInterval(projectorTimer);
    }
    render();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    modal = "player";
    render();
  }
});
window.addEventListener("castling:saved", () => {
  const s = document.querySelector("#save-status");
  if (s) s.textContent = "Saved just now";
});
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js?v=42").then((registration) => {
      void registration.update();
    });
  });

  // Reload once when a newly activated worker replaces an existing stale build.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// Open directly into the working dashboard. First-time users receive a local
// editable tournament immediately instead of an intermediate welcome page.
if (state.view === "pairings") prepareAndPersistAutomaticRound();
render();
