/**
 * Browser application entry point: renders every screen, coordinates user
 * interactions, and persists tournament changes through the service layer.
 */
import "./styles/main.css";
import { createIcons, icons } from "lucide";
import Papa from "papaparse";
import type {
  AppState,
  GameResult,
  Player,
  Round,
  Team,
  TeamScoring,
  Tournament,
} from "./models";
import { storage, download, slug } from "./services/storage";
import {
  generateKnockout,
  generateRoundRobin,
  generateSwiss,
  knockoutRoundCount,
  recommendedSwissRoundCount,
  roundRobinRoundCount,
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
import {
  PRESET_PLAYERS,
  RETIRED_PRESET_PLAYER_IDS,
} from "./data/presetPlayers";
import {
  generateTeamRound,
  teamRoundCount,
  teamStandings,
} from "./services/teamTournament";

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
    teamSize: 4,
    teamScoring: "2-1-0",
    createdAt: new Date().toISOString(),
    finished: false,
  },
  players: [],
  teams: [],
  rounds: [],
  view: "dashboard",
});
const PRESET_SEED_KEY = "castling.player-presets.v2";
const THEME_KEY = "castling.theme.v1";
const LAYOUT_KEY = "castling.layout.v1";
type AppTheme = "dark" | "light" | "criterion" | "ggcc";
type LayoutPreferences = { hideSidebar: boolean; hideTopbar: boolean };

function loadLayoutPreferences(): LayoutPreferences {
  try {
    const saved = JSON.parse(
      localStorage.getItem(LAYOUT_KEY) || "{}",
    ) as Partial<LayoutPreferences>;
    return {
      hideSidebar: saved.hideSidebar === true,
      hideTopbar: saved.hideTopbar === true,
    };
  } catch {
    return { hideSidebar: false, hideTopbar: false };
  }
}

let layoutPreferences = loadLayoutPreferences();

function saveLayoutPreferences(): void {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutPreferences));
}

const THEMES: AppTheme[] = ["dark", "light", "criterion", "ggcc"];
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
          : theme === "ggcc"
            ? "#080b10"
            : "#0b1210",
    );
  localStorage.setItem(THEME_KEY, theme);
}

applyTheme(activeTheme);

/** Add starter profiles once, while respecting profiles an organizer already has. */
function seedPresetPlayers(): void {
  if (localStorage.getItem(PRESET_SEED_KEY)) return;
  // Retired presets are removed only when no saved tournament references them,
  // so upgrading never destroys historical rosters or results.
  for (const id of RETIRED_PRESET_PLAYER_IDS) storage.removePlayer(id);
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
state.teams ||= [];
state.tournament.teamSize ||= 4;
state.tournament.teamScoring ||= "2-1-0";
let draftingNewTournament = false;
let modal = "";
let roundCountEdited = false;
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

const isTeamTournament = (type = state.tournament.type) =>
  type === "Team Swiss" || type === "Team Round Robin";

const isRoundRobinTournament = () =>
  state.tournament.type === "Round Robin" ||
  state.tournament.type === "Team Round Robin";

const roundRobinHasRecordedResults = () =>
  state.rounds.some((round) =>
    round.pairings.some((pairing) => pairing.result !== null),
  );

/** Keep a not-yet-started event aligned with its active field. */
function syncAutomaticRoundCount(): boolean {
  if (tournamentStarted()) return false;
  const teamFormat = isTeamTournament();
  const entrantCount = teamFormat
    ? (state.teams || []).filter((team) => team.active).length
    : state.players.filter((profile) => profile.active).length;
  const roundRobin =
    state.tournament.type === "Round Robin" ||
    state.tournament.type === "Team Round Robin";
  const swiss =
    state.tournament.type === "Swiss System" ||
    state.tournament.type === "Team Swiss";
  let calculated: number | null = null;
  if (roundRobin) calculated = roundRobinRoundCount(entrantCount);
  // Refresh the recommendation only when the roster size changes. This keeps
  // manual organizer adjustments while preventing a stale five-round schedule
  // from surviving when, for example, the field becomes three players.
  if (
    swiss &&
    !state.tournament.swissRoundsManual &&
    state.tournament.roundCountEntrants !== entrantCount
  )
    calculated = recommendedSwissRoundCount(entrantCount);
  if (
    swiss &&
    state.tournament.swissRoundsManual &&
    state.tournament.roundCountEntrants !== entrantCount &&
    entrantCount >= 2
  )
    calculated = Math.min(
      state.tournament.totalRounds,
      roundRobinRoundCount(entrantCount),
    );
  if (calculated === null) return false;
  const changed =
    state.tournament.totalRounds !== calculated ||
    state.tournament.roundCountEntrants !== entrantCount;
  state.tournament.totalRounds = calculated;
  state.tournament.roundCountEntrants = entrantCount;
  return changed;
}

// Correct legacy schedules and stale Swiss recommendations before rendering.
if (hasTournament && syncAutomaticRoundCount()) {
  try {
    storage.save(state);
  } catch (error) {
    console.warn("Automatic Round Robin count could not be persisted", error);
  }
}

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
  roundCountEdited = false;
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

const baseNav = [
  ["dashboard", "layout-dashboard", "Dashboard"],
  ["players", "users", "Players"],
  ["pairings", "swords", "Pairings"],
  ["standings", "trophy", "Standings"],
  ["history", "history", "Rounds"],
  ["help", "circle-help", "Help"],
];
function navigationItems() {
  const items = [...baseNav];
  if (isTeamTournament()) items.splice(2, 0, ["teams", "shield", "Teams"]);
  return items;
}
function shell(content: string) {
  const active = state.view;
  const navButtons = (mobile = false) =>
    navigationItems()
      .map(
        ([v, i, l]) =>
          `<button data-view="${v}" class="${active === v ? "active" : ""}" aria-current="${active === v ? "page" : "false"}">${icon(i, mobile ? 19 : 17)}<span>${l}</span></button>`,
      )
      .join("");
  const layoutClasses = [
    layoutPreferences.hideSidebar ? "sidebar-hidden" : "",
    layoutPreferences.hideTopbar ? "topbar-hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const revealControls =
    layoutPreferences.hideSidebar || layoutPreferences.hideTopbar
      ? `<div class="layout-reveal-controls" aria-label="Hidden navigation controls">${layoutPreferences.hideSidebar ? `<button class="icon-btn" data-action="show-sidebar" aria-label="Show left navigation" data-tooltip="Show left navigation">${icon("panel-left-open")}</button>` : ""}${layoutPreferences.hideTopbar ? `<button class="icon-btn" data-action="show-topbar" aria-label="Show top bar" data-tooltip="Show top bar">${icon("panel-top-open")}</button>` : ""}</div>`
      : "";
  return `<div class="app ${layoutClasses}"><aside class="sidebar"><div class="brand"><img src="./chest-logo.webp" alt=""><div><strong>Chest-Tournament</strong><small>Manager</small></div></div><nav class="nav" aria-label="Main navigation">${navButtons()}</nav><div class="sidebar-foot"><button class="btn" data-action="projector">${icon("presentation")} Projector mode</button><div class="autosave"><span class="dot"></span><span id="save-status">Autosaved locally</span></div></div></aside><main id="main" tabindex="-1"><header class="topbar"><button class="tournament-switcher" data-action="choose-tournament" aria-label="Choose tournament"><span><h1>${h(state.tournament.name)}</h1><p>${state.tournament.type} · ${state.rounds.length ? `Round ${state.rounds.length}` : "Ready to begin"}</p></span>${icon("chevrons-up-down", 15)}</button><div class="toolbar"><button class="btn" data-action="app-settings" aria-label="Appearance settings">${icon("palette")}<span class="hide-mobile"> Theme</span></button><button class="btn" data-action="backup" aria-label="Download backup">${icon("cloud-download")}<span class="hide-mobile"> Backup</span></button>${exportMenu()}</div></header><div class="content">${content}</div></main><nav class="mobile-nav" style="--nav-count:${navigationItems().length}" aria-label="Mobile navigation">${navButtons(true)}</nav>${revealControls}</div>${poster()}${modalView()}${projector ? projectorView() : ""}<input hidden type="file" id="restore-file" accept=".json,application/json">`;
}
function exportMenu() {
  return `<div class="export-menu"><button class="btn" data-action="restore">${icon("upload")}<span class="hide-mobile"> Restore</span></button><button class="btn primary" data-action="toggle-export">${icon("download")}<span class="export-label">Export</span>${icon("chevron-down", 14)}</button>${exportOpen ? `<div class="dropdown" role="menu"><button data-export="pgn">${icon("file-text")} PGN · Tournament</button><button data-export="pdf-standings">${icon("file-text")} PDF · Standings</button><button data-export="pdf-pairings">${icon("file-text")} PDF · Pairings</button><button data-export="pdf-players">${icon("file-text")} PDF · Player list</button><button data-export="png">${icon("image")} PNG · 1080×1350</button><button data-export="jpg">${icon("image")} JPG · 1920×1080</button><button data-export="zip">${icon("package")} ZIP tournament package</button></div>` : ""}</div>`;
}
function metrics() {
  const done = gamesDone(),
    total = gamesTotal();
  const progress = total ? Math.round((done / total) * 100) : 0;
  const entrants = isTeamTournament()
    ? (state.teams || []).filter((team) => team.active).length
    : state.players.filter((player) => player.active).length;
  return `<div class="metrics"><div class="metric"><b>${entrants}</b><span>${isTeamTournament() ? "Active teams" : "Active players"}</span></div><div class="metric"><b>${state.rounds.length}<small> / ${state.tournament.totalRounds}</small></b><span>Current round</span></div><div class="metric"><b>${done}</b><span>Games completed</span></div><div class="metric"><b>${progress}%</b><span>Tournament progress</span></div></div>`;
}
// -----------------------------------------------------------------------------
// Page renderers
// -----------------------------------------------------------------------------

function helpView(): string {
  const topics = [
    ["help-start", "Getting started"],
    ["help-formats", "Tournament formats"],
    ["help-pairings", "Pairings & rounds"],
    ["help-results", "Results"],
    ["help-tiebreaks", "Standings & tie-breaks"],
    ["help-teams", "Team tournaments"],
    ["help-shortcuts", "Keyboard shortcuts"],
    ["help-tools", "Tools & data"],
  ];
  return `<section class="help-page"><header class="help-hero"><div><span class="eyebrow">Organizer handbook</span><h2>Help & tournament guide</h2><p>Learn the complete workflow, how each pairing system works, and how rankings are calculated.</p></div><span class="help-hero-mark" aria-hidden="true">${icon("book-open", 38)}</span></header><div class="help-layout"><nav class="help-toc" aria-label="Help topics"><strong>On this page</strong>${topics.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("")}</nav><div class="help-content">
  <section id="help-start" class="help-section"><div class="help-section-title"><span>${icon("rocket", 20)}</span><div><span class="eyebrow">First steps</span><h3>Getting started</h3></div></div><ol class="help-steps"><li><b>Create a tournament</b><span>Enter its name, format, date, venue, time control, and format-specific settings.</span></li><li><b>Register players</b><span>After creation, Player Management opens automatically. Add saved profiles or create new ones.</span></li><li><b>Review the field</b><span>Player and team registration remains editable until pairing history or recorded results lock the roster.</span></li><li><b>Open Pairings</b><span>The first round is created automatically when at least two eligible entrants are registered.</span></li><li><b>Enter every result</b><span>Review the completed round, then explicitly confirm before the next round is created.</span></li><li><b>Publish the final ranking</b><span>After the scheduled final round, end the tournament to display the official results.</span></li></ol></section>
  <section id="help-formats" class="help-section"><div class="help-section-title"><span>${icon("layout-grid", 20)}</span><div><span class="eyebrow">Competition systems</span><h3>Tournament formats</h3></div></div><div class="help-card-grid"><article class="help-card"><span class="help-card-icon">${icon("git-merge", 20)}</span><h4>Swiss System</h4><p>Players with similar scores are paired while repeat opponents and color imbalance are minimized. The recommended rounds are <b>ceil(log₂ entrants)</b>; the organizer may adjust this up to the no-repeat maximum.</p></article><article class="help-card"><span class="help-card-icon">${icon("table-2", 20)}</span><h4>Round Robin</h4><p>Every player meets every other player exactly once. Even fields play <b>n − 1</b> rounds; odd fields play <b>n</b> rounds with one bye per player. The round count is automatic.</p></article><article class="help-card"><span class="help-card-icon">${icon("network", 20)}</span><h4>Knockout / Elimination</h4><p>A rating-seeded single-elimination bracket. Top seeds are distributed across opposite sections, high seeds receive byes when needed, and only decisive winners advance.</p></article><article class="help-card"><span class="help-card-icon">${icon("shield", 20)}</span><h4>Team formats</h4><p>Team Swiss and Team Round Robin group individual boards into team matches. Exact rosters are selected before registration, and board results feed the team table.</p></article></div></section>
  <section id="help-pairings" class="help-section"><div class="help-section-title"><span>${icon("swords", 20)}</span><div><span class="eyebrow">How opponents are chosen</span><h3>Pairings & rounds</h3></div></div><div class="help-definition-list"><div><b>Swiss ordering</b><p>Entrants are ordered by current points, then rating. The pairing engine prefers close scores, strongly avoids repeat opponents, and balances White and Black assignments.</p></div><div><b>Swiss bye</b><p>When the field is odd, the lowest eligible player who has not already received a bye is selected where possible. A bye scores one point.</p></div><div><b>Round Robin rotation</b><p>A fixed circle rotation generates every unique opponent combination. Colors alternate through the schedule; self-pairings are impossible.</p></div><div><b>Knockout seeding</b><p>The bracket expands to the next power of two. Players are seeded by rating, with names resolving equal ratings. Draws are unavailable because each match needs a winner.</p></div><div><b>Organizer confirmation</b><p>Completing all results does not immediately advance the event. Use the continue action to review and confirm creation of the next round.</p></div><div><b>Roster changes</b><p>An untouched Round Robin opener is rebuilt when the roster changes. Once results are recorded, registration locks to protect the schedule and standings.</p></div></div></section>
  <section id="help-results" class="help-section"><div class="help-section-title"><span>${icon("check-circle-2", 20)}</span><div><span class="eyebrow">Scoring games</span><h3>Results & notation</h3></div></div><div class="help-score-grid"><div><b>1–0</b><span>White wins</span></div><div><b>½–½</b><span>Draw</span></div><div><b>0–1</b><span>Black wins</span></div><div><b>BYE</b><span>One-point unpaired round</span></div></div><p class="help-note">Individual scoring awards 1 point for a win or bye, ½ point for a draw, and 0 for a loss. Select a different result to correct an entry before advancing. Every completed round remains available in the Rounds tab.</p></section>
  <section id="help-tiebreaks" class="help-section"><div class="help-section-title"><span>${icon("scale", 20)}</span><div><span class="eyebrow">Ranking order</span><h3>Standings & tie-breaks</h3></div></div><p>Individual players are sorted using the following order. The first value that differs decides the higher rank.</p><ol class="help-ranking"><li><span>1</span><div><b>Points</b><p>Total game points earned.</p></div></li><li><span>2</span><div><b>Buchholz</b><p>The sum of all opponents’ final or current point totals. A player who faced stronger-scoring opposition receives the higher value.</p></div></li><li><span>3</span><div><b>Sonneborn–Berger</b><p>The full score of every defeated opponent plus half the score of every drawn opponent.</p></div></li><li><span>4</span><div><b>Wins</b><p>The player with more victories ranks higher.</p></div></li><li><span>5</span><div><b>Rating</b><p>Rating resolves a tie that remains after all competition tie-breaks.</p></div></li></ol><aside class="help-callout"><b>Buchholz Cut 1</b><p>The standings report also displays Buchholz with the lowest opponent score removed. It is an informational field and is not currently used in the automatic ranking order.</p></aside></section>
  <section id="help-teams" class="help-section"><div class="help-section-title"><span>${icon("users", 20)}</span><div><span class="eyebrow">Boards become matches</span><h3>Team tournaments</h3></div></div><div class="help-card-grid help-team-grid"><article class="help-card"><h4>2–1–0 match points</h4><p>A team earns 2 for a match win, 1 for a drawn match, and 0 for a loss.</p></article><article class="help-card"><h4>3–1–0 match points</h4><p>A team earns 3 for a match win, 1 for a drawn match, and 0 for a loss.</p></article><article class="help-card"><h4>Board points only</h4><p>Teams rank directly by the total points scored across their individual boards.</p></article></div><p>With match-point scoring, teams rank by <b>match points</b>, then <b>board points</b>, then <b>team Buchholz</b>, then team name. With board-points-only scoring, board points are primary. Team Buchholz sums the primary scores of all opposing teams.</p></section>
  <section id="help-shortcuts" class="help-section"><div class="help-section-title"><span>${icon("keyboard", 20)}</span><div><span class="eyebrow">Faster controls</span><h3>Keyboard shortcuts</h3></div></div><p>Use these shortcuts with a desktop or external keyboard. On macOS, use Command instead of Control.</p><div class="shortcut-list"><div><span><kbd>Ctrl/⌘</kbd><i>+</i><kbd>Alt</kbd><i>+</i><kbd>P</kbd></span><b>Toggle Projector mode</b></div><div><span><kbd>Ctrl/⌘</kbd><i>+</i><kbd>Alt</kbd><i>+</i><kbd>L</kbd></span><b>Show or hide left navigation</b></div><div><span><kbd>Ctrl/⌘</kbd><i>+</i><kbd>Alt</kbd><i>+</i><kbd>T</kbd></span><b>Show or hide the top bar</b></div><div><span><kbd>Ctrl/⌘</kbd><i>+</i><kbd>Alt</kbd><i>+</i><kbd>H</kbd></span><b>Open Help</b></div><div><span><kbd>Ctrl/⌘</kbd><i>+</i><kbd>Alt</kbd><i>+</i><kbd>D</kbd></span><b>Open Dashboard</b></div><div><span><kbd>Ctrl/⌘</kbd><i>+</i><kbd>Alt</kbd><i>+</i><kbd>A</kbd></span><b>Open Appearance & layout</b></div><div><span><kbd>Ctrl/⌘</kbd><i>+</i><kbd>Alt</kbd><i>+</i><kbd>N</kbd></span><b>Create a player profile</b></div><div><span><kbd>Esc</kbd></span><b>Close a dialog or Projector mode</b></div></div><aside class="help-callout"><b>Navigation safety</b><p>The left and top bars can always be restored with the same shortcut, even when their floating restore controls are hidden or out of view.</p></aside></section>
  <section id="help-tools" class="help-section"><div class="help-section-title"><span>${icon("wrench", 20)}</span><div><span class="eyebrow">Presentation & safekeeping</span><h3>Tools, exports & local data</h3></div></div><div class="help-definition-list"><div><b>Projector mode</b><p>Cycles through standings, competition details, and the tournament overview. Round Robin events show their crosstable; Knockout events show the bracket. Previous and Next controls are also available.</p></div><div><b>Player results</b><p>Select a player name in standings or results to open their complete round-by-round tournament record.</p></div><div><b>Exports</b><p>Download PGN, PDF reports, CSV data, images, JSON backups, or a ZIP tournament package from the top toolbar.</p></div><div><b>Backup and restore</b><p>JSON backups preserve tournament data and can be imported later or moved to another browser.</p></div><div><b>Local autosave</b><p>Every action is saved in this browser using local storage. No account or internet connection is required after the app is cached.</p></div><div><b>Multiple tournaments</b><p>Use the tournament switcher in the top bar to create, open, or remove locally stored events.</p></div></div><aside class="help-callout warning"><b>Protect your records</b><p>Browser data can be cleared by device cleanup or privacy settings. Export a JSON backup regularly, especially before removing a tournament.</p></aside></section>
</div></div></section>`;
}

/** Render manual Swiss/Team rounds or an automatic Round Robin calculation. */
function roundCountField(tournament: Tournament): string {
  const roundRobin =
    tournament.type === "Round Robin" || tournament.type === "Team Round Robin";
  const swiss =
    tournament.type === "Swiss System" || tournament.type === "Team Swiss";
  const teamFormat = isTeamTournament(tournament.type);
  const entryCount = teamFormat
    ? (state.teams || []).filter((team) => team.active).length
    : state.players.filter((profile) => profile.active).length;
  const entryLabel = teamFormat ? "teams" : "players";
  const calculated = roundRobinRoundCount(entryCount);
  const recommended = recommendedSwissRoundCount(entryCount);
  const summary = calculated
    ? `${calculated} round${calculated === 1 ? "" : "s"} for ${entryCount} ${entryLabel}`
    : `Calculated automatically after at least 2 ${entryLabel} are registered`;
  const swissHelp = recommended
    ? `Recommended: ${recommended} round${recommended === 1 ? "" : "s"} for ${entryCount} ${entryLabel}. Maximum ${calculated} without repeat pairings.`
    : `A recommendation will be calculated after at least 2 ${entryLabel} are registered.`;
  const maximum = swiss && calculated ? calculated : 30;
  return `<div class="field"><label>Number of rounds</label><input id="round-count-input" class="round-count-input" name="totalRounds" type="number" min="1" max="${maximum}" value="${tournament.totalRounds || recommended || 1}" ${roundRobin ? "hidden disabled" : ""}><output id="round-count-output" class="derived-field round-count-output" ${roundRobin ? "" : "hidden"}>${summary}</output><small id="round-count-help">${roundRobin ? (teamFormat ? "Every team meets every other team once." : "Every player meets every other player once; self-pairings are excluded.") : swiss ? swissHelp : "Choose the scheduled number of rounds."}</small></div>`;
}

function teamSettingsFields(tournament: Tournament): string {
  const visible = isTeamTournament(tournament.type);
  return `<div id="team-settings-fields" class="team-settings-fields full-field" ${visible ? "" : "hidden"}><div class="field"><label>Players per team *</label><input name="teamSize" type="number" min="1" max="20" required value="${tournament.teamSize || 4}"><small>Each team must select exactly this many players.</small></div><div class="field"><label>Team scoring system *</label><select name="teamScoring"><option value="2-1-0" ${tournament.teamScoring === "2-1-0" ? "selected" : ""}>2–1–0 match points</option><option value="3-1-0" ${tournament.teamScoring === "3-1-0" ? "selected" : ""}>3–1–0 match points</option><option value="board-points" ${tournament.teamScoring === "board-points" ? "selected" : ""}>Board points only</option></select><small>Board points remain available as a tie-break for match-point systems.</small></div></div>`;
}

function updateTeamSettingsVisibility(type: Tournament["type"]): void {
  const fields = document.querySelector<HTMLElement>("#team-settings-fields");
  if (fields) fields.hidden = !isTeamTournament(type);
}

/** Update the round field immediately when the tournament format changes. */
function updateRoundCountControls(type: Tournament["type"]): void {
  const input = document.querySelector<HTMLInputElement>("#round-count-input");
  const output = document.querySelector<HTMLOutputElement>(
    "#round-count-output",
  );
  const help = document.querySelector<HTMLElement>("#round-count-help");
  if (!input || !output || !help) return;
  const automatic = type === "Round Robin" || type === "Team Round Robin";
  const swiss = type === "Swiss System" || type === "Team Swiss";
  const teamFormat = isTeamTournament(type);
  const entryCount = teamFormat
    ? (state.teams || []).filter((team) => team.active).length
    : state.players.filter((profile) => profile.active).length;
  const entryLabel = teamFormat ? "teams" : "players";
  const rounds = roundRobinRoundCount(entryCount);
  const recommended = recommendedSwissRoundCount(entryCount);
  updateTeamSettingsVisibility(type);
  input.hidden = automatic;
  input.disabled = automatic;
  output.hidden = !automatic;
  if (!automatic) {
    input.max = swiss && rounds ? String(rounds) : "30";
    if (swiss && recommended) input.value = String(recommended);
    else if (Number(input.value) < 1) input.value = "1";
    help.textContent =
      swiss && recommended
        ? `Recommended: ${recommended} round${recommended === 1 ? "" : "s"} for ${entryCount} ${entryLabel}. Maximum ${rounds} without repeat pairings.`
        : swiss
          ? `A recommendation will be calculated after at least 2 ${entryLabel} are registered.`
          : "Choose the scheduled number of rounds.";
    return;
  }
  output.value = rounds
    ? `${rounds} round${rounds === 1 ? "" : "s"} for ${entryCount} ${entryLabel}`
    : `Calculated automatically after at least 2 ${entryLabel} are registered`;
  help.textContent = teamFormat
    ? "Every team meets every other team once."
    : "Every player meets every other player once; self-pairings are excluded.";
}

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
          ${roundCountField(t)}
          <div class="field"><label>Tournament type</label><select id="tournament-type" name="type">${["Swiss System", "Round Robin", "Knockout", "Team Swiss", "Team Round Robin"].map((type) => `<option ${t.type === type ? "selected" : ""}>${type}</option>`).join("")}</select></div>
          ${teamSettingsFields(t)}
        </div>
        <button class="btn primary creation-submit" type="submit">${icon("arrow-right")} Create tournament</button>
      </form>
    </section>
  </main>${modalView()}<input hidden type="file" id="restore-file" accept=".json,application/json">`;
}

function dashboard() {
  const teamFormat = isTeamTournament();
  const leaders = teamFormat
    ? teamStandings(
        state.teams || [],
        state.rounds,
        state.tournament.teamScoring || "2-1-0",
      ).slice(0, 5)
    : standings(state.players, state.rounds).slice(0, 5);
  const management = teamFormat
    ? `<button type="button" data-view="teams">${icon("shield-plus")}<b>Manage teams</b><span class="muted">Build and register rosters</span></button>`
    : `<button type="button" data-action="go-players">${icon("user-plus")}<b>Add player</b><span class="muted">Open player management</span></button>`;
  const leadersView = leaders.length
    ? teamFormat
      ? teamStandingsTable(leaders as ReturnType<typeof teamStandings>)
      : standingsTable(leaders as ReturnType<typeof standings>)
    : empty(
        teamFormat ? "♜" : "♟",
        `Your ${teamFormat ? "team " : ""}tournament is ready`,
        teamFormat
          ? "Create and register at least two complete teams to begin."
          : "Add players to begin pairing your first round.",
        teamFormat ? "Manage teams" : "Manage players",
        teamFormat ? "go-teams" : "go-players",
      );
  return `<section class="hero"><span class="eyebrow">${state.tournament.finished ? "Tournament complete" : "Tournament control"}</span><h2>${h(state.tournament.name)}</h2><p class="muted">${icon("map-pin", 14)} ${h(state.tournament.venue)} &nbsp;·&nbsp; ${h(state.tournament.date)} &nbsp;·&nbsp; ${h(state.tournament.timeControl)}</p></section>${metrics()}<div class="section-head"><h3>Quick actions</h3><button class="btn" data-action="edit-tournament" ${tournamentStarted() ? 'disabled data-tooltip="Tournament settings lock when Round 1 starts"' : ""}>${icon(tournamentStarted() ? "lock" : "settings")} Tournament settings</button></div><div class="quick"><button data-action="new-tournament">${icon("plus-circle")}<b>New tournament</b><span class="muted">Start from scratch</span></button>${management}<button data-view="standings">${icon("bar-chart-3")}<b>Live standings</b><span class="muted">View leaderboard</span></button><button data-action="toggle-export">${icon("download")}<b>Export center</b><span class="muted">Reports & packages</span></button></div><div class="section-head"><h3>${state.tournament.finished ? "Final Rank" : "Current standings"}</h3><span class="muted">${state.tournament.finished ? "Official final tie-breaks" : "Provisional tie-breaks"}</span></div>${leadersView}`;
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
    <div class="toolbar player-toolbar">
      <input class="search" id="player-search" value="${h(search)}" placeholder="Search player profiles…" aria-label="Search player profiles">
      <button class="btn" data-action="sort">${icon("arrow-up-down")} ${sort === "rating" ? "Rating" : "Name"}</button>
      <button class="btn" data-action="import-csv">${icon("upload")} CSV</button>
      <button class="btn" data-action="export-csv">${icon("download")} CSV</button>
      <button type="button" class="btn primary new-profile-button" data-action="add-player">${icon("user-plus")} New profile</button>
    </div>
  </div>
  <div class="roster-summary"><span><b>${state.players.filter((profile) => profile.active).length}</b> registered for this tournament</span><span><b>${list.length}</b> profiles in your directory</span></div>
  ${
    list.length
      ? `<div class="table-wrap players-table-wrap"><table class="players-table"><thead><tr><th>Player</th><th>Rating</th><th>Age</th><th>Category</th><th>Club</th><th>Federation</th><th>Tournament</th><th></th></tr></thead><tbody>${list
          .map((profile) => {
            const registered = registeredIds.has(profile.id);
            return `<tr><td class="player-primary"><button class="icon-btn" data-player="${profile.id}" style="color:inherit">${avatarMarkup(profile)}<b>${h(profile.name)}</b></button></td><td class="player-detail mono" data-label="Rating">${profile.rating}</td><td class="player-detail" data-label="Age">${profile.age || "—"}</td><td class="player-detail" data-label="Category"><span class="pill">${h(profile.ageCategory || categoryForAge(profile.age))}</span></td><td class="player-detail player-club" data-label="Club">${h(profile.club || "—")}</td><td class="player-detail federation-cell" data-label="Federation">${profile.country ? countryFlag(profile.country) : "—"}</td><td class="player-registration">${
              registered
                ? `<button class="btn registration registered" data-remove-from-tournament="${profile.id}">${icon("check", 14)} Registered</button>`
                : `<button class="btn registration" data-add-to-tournament="${profile.id}">${icon("plus", 14)} Add to tournament</button>`
            }</td><td class="player-actions"><button class="btn player-results-link" data-player="${profile.id}">${icon("list", 14)} Results</button><button class="icon-btn" data-edit-player="${profile.id}" aria-label="Edit ${h(profile.name)}">${icon("pencil")}</button><button class="icon-btn" data-delete-player="${profile.id}" aria-label="Delete ${h(profile.name)}">${icon("trash-2")}</button></td></tr>`;
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
function teamsView() {
  const teams = state.teams || [];
  const size = state.tournament.teamSize || 4;
  const profiles = storage.listPlayers();
  return `<div class="section-head"><div><span class="eyebrow">Team directory</span><h2>Team management</h2><p class="muted">Build exact ${size}-player rosters, then choose which teams compete in ${h(state.tournament.name)}.</p></div><div class="toolbar"><button class="btn" data-view="players">${icon("users")} Manage players</button><button class="btn primary" data-action="add-team" ${tournamentStarted() ? "disabled" : ""}>${icon("shield-plus")} Create team</button></div></div><div class="roster-summary"><span><b>${teams.filter((team) => team.active).length}</b> teams registered</span><span><b>${size}</b> players per team</span><span><b>${h(state.tournament.teamScoring || "2-1-0")}</b> scoring</span></div>${
    profiles.length < size
      ? empty(
          "♙",
          "More player profiles needed",
          `Create at least ${size} player profiles before building a team.`,
          "Manage players",
          "go-players",
        )
      : teams.length
        ? `<div class="team-grid">${teams
            .map((team) => {
              const members = team.playerIds
                .map((id) => player(id))
                .filter(Boolean);
              return `<article class="team-card ${team.active ? "active" : ""}"><div class="team-card-head"><span class="team-mark">${icon("shield", 20)}</span><div><h3>${h(team.name)}</h3><small>${members.length}/${size} players</small></div><div class="team-actions"><button class="icon-btn" data-edit-team="${team.id}" aria-label="Edit ${h(team.name)}" ${tournamentStarted() ? "disabled" : ""}>${icon("pencil")}</button><button class="icon-btn" data-delete-team="${team.id}" aria-label="Delete ${h(team.name)}" ${tournamentStarted() ? "disabled" : ""}>${icon("trash-2")}</button></div></div><div class="team-members">${members.map((member, index) => `<span><b>${index + 1}</b>${avatarMarkup(member!)}<span>${h(member!.name)}<small>${member!.rating}</small></span></span>`).join("")}</div>${team.active ? `<button class="btn registration registered" data-remove-team="${team.id}" ${tournamentStarted() ? "disabled" : ""}>${icon("check", 14)} Registered</button>` : `<button class="btn registration" data-add-team="${team.id}" ${team.playerIds.length !== size || tournamentStarted() ? "disabled" : ""}>${icon("plus", 14)} Add team to tournament</button>`}</article>`;
            })
            .join("")}</div>`
        : empty(
            "♜",
            "No teams yet",
            `Create a team and select exactly ${size} players.`,
            "Create first team",
            "add-team",
          )
  }`;
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

  const meetingsFor = (profileId: string, opponentId: string) =>
    games.filter(
      ({ game }) =>
        game.blackId &&
        ((game.whiteId === profileId && game.blackId === opponentId) ||
          (game.whiteId === opponentId && game.blackId === profileId)),
    );

  const rows = participants
    .map((profile, rowIndex) => {
      const entry = stats.get(profile.id);
      const cells = participants
        .map((opponent) => {
          if (profile.id === opponent.id)
            return '<td class="rr-self" aria-label="Same player">×</td>';
          const meetings = meetingsFor(profile.id, opponent.id);
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

  return `<section class="round-robin-panel" aria-label="Round Robin crosstable"><div class="bracket-panel-head"><div><span class="eyebrow">All-play-all matrix</span><h3>Round Robin table</h3></div><span class="pill">${participants.length} players · ${state.rounds.length}/${state.tournament.totalRounds} rounds</span></div><div class="round-robin-scroll"><table class="round-robin-table"><thead><tr><th>No.</th><th>Player</th>${participants.map((_, index) => `<th aria-label="Player ${index + 1}">${index + 1}</th>`).join("")}<th>Pts.</th><th>Rk.</th></tr></thead><tbody>${rows}</tbody></table></div><p class="rr-mobile-scroll-hint">Swipe sideways to view the complete matrix. Player numbers and names stay pinned.</p><div class="rr-legend"><span><i class="rr-white"></i> Played as White</span><span><i class="rr-black"></i> Played as Black</span><span><i class="rr-current"></i> Current round</span></div></section>`;
}

function teamPairingsCards(round: Round): string {
  const groups = new Map<string, Round["pairings"]>();
  for (const game of round.pairings) {
    const id = game.teamMatchId || game.id;
    const boards = groups.get(id) || [];
    boards.push(game);
    groups.set(id, boards);
  }
  const teamById = (id?: string | null) =>
    (state.teams || []).find((team) => team.id === id);
  return `<div class="team-match-grid">${[...groups.values()]
    .map((boards, index) => {
      const ids = new Set(
        boards.flatMap((game) =>
          [game.whiteTeamId, game.blackTeamId].filter(Boolean),
        ),
      );
      const [firstId, secondId] = [...ids];
      const first = teamById(firstId);
      const second = teamById(secondId);
      const score = (teamId?: string | null) =>
        boards.reduce((sum, game) => {
          if (!teamId || !game.result) return sum;
          if (game.result === "BYE") return sum + 1;
          if (game.result === "½-½") return sum + 0.5;
          const whiteWon = game.result === "1-0" || game.result === "1F-0F";
          return (
            sum +
            ((whiteWon && game.whiteTeamId === teamId) ||
            (!whiteWon && game.blackTeamId === teamId)
              ? 1
              : 0)
          );
        }, 0);
      return `<section class="team-match-card"><header><span class="board-no">Match ${index + 1}</span><div><b>${h(first?.name || "Team")}</b><strong>${score(firstId).toFixed(1)} – ${second ? score(secondId).toFixed(1) : "BYE"}</strong><b>${h(second?.name || "Bye")}</b></div></header><div class="card">${boards.map((game) => board(game, round)).join("")}</div></section>`;
    })
    .join("")}</div>`;
}

function pairingsView() {
  const r = currentRound();
  const knockout = state.tournament.type === "Knockout";
  const roundRobin = state.tournament.type === "Round Robin";
  const teamFormat = isTeamTournament();
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
  const emptyState = teamFormat
    ? empty(
        "♜",
        "Add teams to begin",
        `At least two active teams with exactly ${state.tournament.teamSize || 4} players are required.`,
        "Manage teams",
        "go-teams",
      )
    : empty(
        "♞",
        "Add players to begin",
        "At least two active players are required. Pairings will be generated automatically.",
        "Manage players",
        "go-players",
      );
  return `<div class="section-head"><div><span class="eyebrow">${knockout ? "Single elimination" : "Tournament room"}</span><h2>${title}</h2></div><div class="toolbar">${canEndTournament() ? `<button class="btn gold" data-action="end-tournament">${icon("flag")} End tournament</button>` : ""}${state.tournament.finished ? `<span class="pill final-status">${icon("trophy", 12)} Final</span>` : ""}</div></div>${r ? `${knockout ? knockoutBracketView() : roundRobin ? roundRobinTableView() : ""}<div class="current-round-label"><span class="eyebrow">${knockout ? `${knockoutRoundLabel(r.number)} controls` : `Round ${r.number}`}</span><h3>${knockout ? "Enter decisive results" : "Enter results"}</h3></div>${teamFormat ? teamPairingsCards(r) : `<div class="card">${r.pairings.map((g) => board(g, r)).join("")}</div>`}${canAdvance ? `<section class="round-complete-prompt" aria-live="polite"><div><span class="eyebrow">Results complete</span><h3>Review Round ${r.number} before continuing</h3><p>Pairings for Round ${r.number + 1} will only be created after your confirmation.</p></div><button class="btn primary" data-action="review-next-round">${icon("arrow-right")} Continue to Round ${r.number + 1}</button></section>` : ""}<p class="muted" style="font-size:12px;margin-top:12px">${resultHelp}</p>` : emptyState}`;
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
  ];
  return `<div class="board-card"><span class="board-no">B${g.board}</span><div class="player-side"><span class="piece white">♔</span><span><b>${h(w?.name)}</b><small class="muted" style="display:block">${w?.rating}</small></span></div><div class="result-buttons" aria-label="Result for board ${g.board}">${choices.map(([v, l]) => `<button data-result="${v}" data-game="${g.id}" ${!r.locked || state.tournament.finished ? "disabled" : ""} class="${g.result === v ? "selected" : ""}" title="${v}">${l}</button>`).join("")}</div><div class="player-side" style="justify-content:flex-end;text-align:right"><span><b>${h(b.name)}</b><small class="muted" style="display:block">${b.rating}</small></span><span class="piece black">♚</span></div></div>`;
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
  if (state.tournament.finished) return "Official Final Ranking";
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
    .join("")}</tbody></table></div><div class="mobile-ranking-list">${rows
    .map(
      (entry) =>
        `<article class="mobile-rank-card medal-${entry.rank}"><span class="mobile-rank-number">${entry.rank}</span><div class="mobile-rank-player"><span><button data-player="${entry.player.id}">${h(entry.player.name)}</button><small>${federationCode(entry.player.country)} · ${entry.player.rating || 0}${entry.player.club ? ` · ${h(entry.player.club)}` : ""}</small></span></div><div class="mobile-rank-score"><b>${entry.points.toFixed(1)}</b><small>Points</small></div><dl><div><dt>TB1</dt><dd>${entry.buchholz.toFixed(1)}</dd></div><div><dt>TB2</dt><dd>${entry.buchholzCut.toFixed(1)}</dd></div><div><dt>TB3</dt><dd>${entry.sonneborn.toFixed(1)}</dd></div></dl></article>`,
    )
    .join("")}</div></section>`;
}
function teamStandingsTable(
  rows = teamStandings(
    state.teams || [],
    state.rounds,
    state.tournament.teamScoring || "2-1-0",
  ),
) {
  const boardOnly = state.tournament.teamScoring === "board-points";
  return `<div class="table-wrap"><table class="ranking-table team-ranking-table"><thead><tr><th>Rk.</th><th>Team</th><th>Roster</th>${boardOnly ? "" : "<th>MP</th>"}<th>BP</th><th>W</th><th>D</th><th>L</th><th>TB1</th></tr></thead><tbody>${rows.map((entry) => `<tr class="medal-${entry.rank}"><td class="rank">${entry.rank}</td><td><b>${h(entry.team.name)}</b></td><td>${entry.team.playerIds.map((id) => h(player(id)?.name || "Unknown")).join(", ")}</td>${boardOnly ? "" : `<td class="score">${entry.matchPoints}</td>`}<td class="score">${entry.boardPoints.toFixed(1)}</td><td>${entry.wins}</td><td>${entry.draws}</td><td>${entry.losses}</td><td>${entry.buchholz.toFixed(1)}</td></tr>`).join("")}</tbody></table></div><div class="mobile-ranking-list team-mobile-ranking">${rows.map((entry) => `<article class="mobile-rank-card medal-${entry.rank}"><span class="mobile-rank-number">${entry.rank}</span><div class="mobile-rank-player"><span class="team-mark">${icon("shield", 16)}</span><span><b>${h(entry.team.name)}</b><small>${entry.team.playerIds.map((id) => h(player(id)?.name || "Unknown")).join(" · ")}</small></span></div><div class="mobile-rank-score"><b>${boardOnly ? entry.boardPoints.toFixed(1) : entry.matchPoints}</b><small>${boardOnly ? "BP" : "MP"}</small></div><dl><div><dt>Board pts</dt><dd>${entry.boardPoints.toFixed(1)}</dd></div><div><dt>W-D-L</dt><dd>${entry.wins}-${entry.draws}-${entry.losses}</dd></div><div><dt>TB1</dt><dd>${entry.buchholz.toFixed(1)}</dd></div></dl></article>`).join("")}</div>`;
}

function finalResultsBanner(
  entries: Array<{
    name: string;
    value: string;
    unit: string;
    playerId?: string;
    portrait?: string;
  }>,
  teamEvent = false,
): string {
  const titles = ["Champion", "Runner-up", "Third place"];
  const trophies = [icon("trophy", 44), icon("trophy", 34), icon("trophy", 34)];
  const meta = [
    state.tournament.venue || "Venue not set",
    state.tournament.date,
    `${state.rounds.length} round${state.rounds.length === 1 ? "" : "s"}`,
  ];
  const finalists = entries.slice(0, 3);
  // Render in physical podium order—not just CSS order—so the champion remains
  // the center column across themes, cached styles, exports, and screenshots.
  const displayOrder =
    finalists.length >= 3 ? [1, 0, 2] : finalists.length === 2 ? [1, 0] : [0];
  return `<section class="final-banner"><div class="final-banner-head"><span class="final-kicker"><i></i>${teamEvent ? "Official team results" : "Official final results"}<i></i></span><h2>${h(state.tournament.name)}</h2><p>${meta.map(h).join(" · ")}</p></div><div class="podium">${displayOrder
    .map((index) => {
      const entry = finalists[index];
      return `<article class="podium-${index + 1}"><span class="podium-rank-badge">${index + 1}</span><div class="podium-emblem" aria-hidden="true">${trophies[index]}</div><small class="podium-title">${titles[index]}</small><div class="podium-entrant">${entry.portrait || ""}${entry.playerId ? `<button data-player="${entry.playerId}">${h(entry.name)}</button>` : `<b>${h(entry.name)}</b>`}</div><strong class="podium-score">${entry.value}<small>${h(entry.unit)}</small></strong>${index === 0 ? '<span class="champion-ribbon">Tournament winner</span>' : ""}</article>`;
    })
    .join("")}</div></section>`;
}

function teamStandingsView() {
  const rows = teamStandings(
    state.teams || [],
    state.rounds,
    state.tournament.teamScoring || "2-1-0",
  );
  const final = state.tournament.finished;
  const podium = final
    ? finalResultsBanner(
        rows.slice(0, 3).map((entry) => ({
          name: entry.team.name,
          value:
            state.tournament.teamScoring === "board-points"
              ? entry.boardPoints.toFixed(1)
              : String(entry.matchPoints),
          unit:
            state.tournament.teamScoring === "board-points"
              ? "board points"
              : "match points",
          portrait: `<span class="podium-team-mark">${icon("shield", 18)}</span>`,
        })),
        true,
      )
    : "";
  return `${podium}<div class="section-head"><div><span class="eyebrow">${final ? "Certified team results" : "Live team leaderboard"}</span><h2>${final ? "Final Rank" : "Team standings"}</h2></div><div class="toolbar">${canEndTournament() ? `<button class="btn gold" data-action="end-tournament">${icon("flag")} End tournament</button>` : ""}<button class="btn" data-action="projector">${icon("presentation")} Projector</button></div></div>${rows.length ? teamStandingsTable(rows) : empty("♜", "Standings await", "Register teams and complete matches to see rankings.", "Manage teams", "go-teams")}`;
}

function standingsView() {
  if (isTeamTournament()) return teamStandingsView();
  const rows = standings(state.players, state.rounds);
  const final = state.tournament.finished;
  const podium = final
    ? finalResultsBanner(
        rows.slice(0, 3).map((entry) => ({
          name: entry.player.name,
          value: entry.points.toFixed(1),
          unit: "points",
          playerId: entry.player.id,
        })),
      )
    : "";
  return `${podium}<div class="section-head"><div><span class="eyebrow">${final ? "Certified results" : "Live leaderboard"}</span><h2>${final ? "Final Rank" : "Standings"}</h2></div><div class="toolbar">${canEndTournament() ? `<button class="btn gold" data-action="end-tournament">${icon("flag")} End tournament</button>` : ""}<button class="btn" data-action="projector">${icon("presentation")} Projector</button><button class="btn" data-export="pdf-standings">${icon("printer")} PDF</button></div></div>${rows.length ? standingsTable(rows, true) : empty("♛", "Standings await", "Add players and complete games to see live rankings.", "Manage players", "go-players")}`;
}
function resultNotation(result: GameResult): string {
  if (!result) return "Pending";
  if (result === "BYE") return "Bye";
  return result
    .replace("½-½", "½–½")
    .replace("1-0", "1–0")
    .replace("0-1", "0–1");
}

/** Read-only board used in the permanent round archive. */
function archivedBoard(game: Round["pairings"][number]): string {
  const white = player(game.whiteId);
  const black = player(game.blackId);
  return `<article class="archived-board ${game.result ? "complete" : "pending"}"><span class="board-no">Board ${game.board}</span><div class="archived-player"><span class="piece white">♔</span><span><b>${h(white?.name || "Unknown")}</b><small>${white?.rating || "—"}</small></span></div><strong class="archived-result">${h(resultNotation(game.result))}</strong><div class="archived-player black-side">${black ? `<span><b>${h(black.name)}</b><small>${black.rating}</small></span><span class="piece black">♚</span>` : `<span><b>Bye</b><small>No opponent</small></span>`}</div></article>`;
}

function archivedRoundBoards(round: Round): string {
  if (!isTeamTournament())
    return `<div class="archived-boards">${round.pairings.map(archivedBoard).join("")}</div>`;
  const matches = new Map<string, Round["pairings"]>();
  for (const game of round.pairings) {
    const key = game.teamMatchId || game.id;
    const boards = matches.get(key) || [];
    boards.push(game);
    matches.set(key, boards);
  }
  return `<div class="team-match-grid">${[...matches.values()]
    .map((boards, index) => {
      const whiteTeam = (state.teams || []).find(
        (team) =>
          team.id === boards.find((game) => game.whiteTeamId)?.whiteTeamId,
      );
      const blackTeam = (state.teams || []).find(
        (team) =>
          team.id === boards.find((game) => game.blackTeamId)?.blackTeamId,
      );
      return `<section class="team-match-card archived-team-match"><header><span class="board-no">Match ${index + 1}</span><div><b>${h(whiteTeam?.name || "Team")}</b><strong>vs</strong><b>${h(blackTeam?.name || "Bye")}</b></div></header>${boards.map(archivedBoard).join("")}</section>`;
    })
    .join("")}</div>`;
}

function historyView() {
  const n = selectedRound || currentRound()?.number;
  const r = state.rounds.find((x) => x.number === n);
  const completed =
    r?.pairings.filter((game) => game.result !== null).length || 0;
  const decisive =
    r?.pairings.filter(
      (game) => game.result && !["½-½", "BYE"].includes(game.result),
    ).length || 0;
  const draws = r?.pairings.filter((game) => game.result === "½-½").length || 0;
  const byes = r?.pairings.filter((game) => game.result === "BYE").length || 0;
  return `<div class="section-head"><div><span class="eyebrow">Permanent archive</span><h2>Round results</h2><p class="muted">Review every pairing and recorded result from each round.</p></div><div class="toolbar">${state.rounds.length && !state.tournament.finished ? `<button class="btn danger" data-action="undo-round">${icon("undo-2")} Undo last round</button>` : ""}</div></div><div class="round-tabs" aria-label="Choose round">${state.rounds.map((x) => `<button class="btn ${x.number === n ? "primary" : ""}" data-round="${x.number}" aria-pressed="${x.number === n}">Round ${x.number}<small>${isComplete(x) ? "Complete" : "Open"}</small></button>`).join("")}</div>${r ? `<section class="round-result-summary"><div><span class="eyebrow">Selected round</span><h3>Round ${r.number} results</h3></div><span><b>${completed}</b>/${r.pairings.length} recorded</span><span><b>${decisive}</b> decisive</span><span><b>${draws}</b> draws</span>${byes ? `<span><b>${byes}</b> byes</span>` : ""}</section>${archivedRoundBoards(r)}${!isComplete(r) && r !== currentRound() ? `<button class="btn" data-action="reopen-round" data-round="${r.number}" style="margin-top:12px">Reopen unfinished round</button>` : ""}` : empty("♜", "No round results yet", "Pairings and results from every round will remain available here.", "Go to pairings", "go-pairings")}`;
}
function poster() {
  const table = isTeamTournament()
    ? teamStandingsTable(
        teamStandings(
          state.teams || [],
          state.rounds,
          state.tournament.teamScoring || "2-1-0",
        ).slice(0, 12),
      )
    : standingsTable(standings(state.players, state.rounds).slice(0, 12));
  return `<div class="poster" id="poster"><span class="eyebrow">Official live standings</span><h1>${h(state.tournament.name)}</h1><p style="font-size:25px;color:#9eb7ac">${h(state.tournament.venue)} · ${h(state.tournament.date)} · ${h(state.tournament.type)} · ${h(state.tournament.timeControl)} · Round ${state.rounds.length}</p>${table}<p style="position:absolute;bottom:60px">Generated with Chest-Tournament Manager</p></div>`;
}
// -----------------------------------------------------------------------------
// Dialog and sheet renderers
// -----------------------------------------------------------------------------

function modalView() {
  if (!modal && !selectedPlayer) return "";
  if (selectedPlayer) return profileModal(selectedPlayer);
  if (modal === "player" || modal.startsWith("player:")) return playerForm();
  if (modal === "team" || modal.startsWith("team:")) return teamForm();
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
    {
      id: "ggcc",
      name: "GGCC",
      description:
        "GMA Gambit Chess Club black, championship gold, and crisp white.",
    },
  ];
  return `<div class="modal-backdrop"><section class="modal appearance-modal" role="dialog" aria-modal="true" aria-labelledby="appearance-title" data-modal><div class="modal-head"><div><span class="eyebrow">Application settings</span><h2 id="appearance-title">Appearance & layout</h2><p class="muted">Preferences are saved on this device and apply to every tournament.</p></div><button class="icon-btn" data-action="close-modal" aria-label="Close">${icon("x")}</button></div><section class="appearance-setting-group" aria-labelledby="theme-setting-title"><h3 id="theme-setting-title">Choose a theme</h3><div class="theme-options" role="radiogroup" aria-label="Color theme">${choices
    .map(
      (choice) =>
        `<button type="button" class="theme-option ${activeTheme === choice.id ? "active" : ""}" data-theme-choice="${choice.id}" role="radio" aria-checked="${activeTheme === choice.id}"><span class="theme-preview theme-preview-${choice.id}" aria-hidden="true"><i></i><b></b><em></em></span><span class="theme-copy"><strong>${choice.name}</strong><small>${choice.description}</small><span class="theme-select-label"><span class="theme-radio" aria-hidden="true">${activeTheme === choice.id ? icon("check", 13) : ""}</span>${activeTheme === choice.id ? "Current theme" : "Select theme"}</span></span></button>`,
    )
    .join(
      "",
    )}</div></section><section class="appearance-setting-group layout-settings" aria-labelledby="layout-setting-title"><div><h3 id="layout-setting-title">Navigation layout</h3><p class="muted">Hide desktop navigation bars for a distraction-free workspace. Floating restore controls remain available.</p></div><div class="layout-setting-options"><button type="button" class="layout-setting-option" data-layout-toggle="sidebar" role="switch" aria-checked="${layoutPreferences.hideSidebar}"><span class="layout-setting-icon">${icon("panel-left")}</span><span><b>Hide left navigation</b><small>Expand tournament content across the full width.</small></span><span class="switch-control" aria-hidden="true"><i></i></span></button><button type="button" class="layout-setting-option" data-layout-toggle="topbar" role="switch" aria-checked="${layoutPreferences.hideTopbar}"><span class="layout-setting-icon">${icon("panel-top")}</span><span><b>Hide top bar</b><small>Remove tournament, theme, backup, and export controls.</small></span><span class="switch-control" aria-hidden="true"><i></i></span></button></div></section></section></div>`;
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
function teamForm() {
  const editing = modal.startsWith("team:");
  const existing = editing
    ? (state.teams || []).find((team) => team.id === modal.split(":")[1])
    : undefined;
  const size = state.tournament.teamSize || 4;
  const occupied = new Set(
    (state.teams || [])
      .filter((team) => team.id !== existing?.id)
      .flatMap((team) => team.playerIds),
  );
  const profiles = storage.listPlayers();
  return `<div class="modal-backdrop"><section class="modal team-modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title" data-modal><div class="modal-head"><div><span class="eyebrow">${editing ? "Edit roster" : "New roster"}</span><h2 id="team-modal-title">${editing ? h(existing?.name || "Team") : "Create team"}</h2><p class="muted">Choose exactly ${size} unique players.</p></div><button class="icon-btn" data-action="close-modal" aria-label="Close">${icon("x")}</button></div><form id="team-form"><input type="hidden" name="id" value="${existing?.id || ""}"><div class="field"><label>Team name *</label><input name="name" required autofocus value="${h(existing?.name || "")}" placeholder="e.g. Green Knights"></div><div class="team-player-picker" role="group" aria-label="Choose ${size} players">${profiles
    .map((profile) => {
      const selected = existing?.playerIds.includes(profile.id) || false;
      const unavailable = occupied.has(profile.id) && !selected;
      return `<label class="team-player-option ${unavailable ? "unavailable" : ""}"><input type="checkbox" name="playerIds" value="${profile.id}" ${selected ? "checked" : ""} ${unavailable ? "disabled" : ""}><span>${avatarMarkup(profile)}<span><b>${h(profile.name)}</b><small>${profile.rating} · ${h(profile.club || "Independent")}</small></span></span></label>`;
    })
    .join(
      "",
    )}</div><output id="team-player-count" class="team-player-count" aria-live="polite">${existing?.playerIds.length || 0} of ${size} selected</output><label class="registration-option"><input type="checkbox" name="registerCurrent" ${existing?.active === false ? "" : "checked"}><span><b>Add team to this tournament</b><small>The team becomes eligible for pairings immediately.</small></span></label><div class="toolbar" style="justify-content:flex-end;margin-top:22px"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary">${editing ? "Save team" : "Create team"}</button></div></form></section></div>`;
}
function tournamentForm() {
  const t = state.tournament;
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" data-modal><div class="modal-head"><h2>Tournament settings</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">${icon("x")}</button></div><form id="tournament-form"><div class="form-grid"><div class="field"><label>Tournament name *</label><input name="name" required value="${h(t.name)}"></div><div class="field"><label>Venue</label><input name="venue" value="${h(t.venue)}"></div><div class="field"><label>Organizer</label><input name="organizer" value="${h(t.organizer)}"></div><div class="field"><label>Date</label><input name="date" type="date" value="${t.date}"></div><div class="field"><label>Time control</label><input name="timeControl" value="${h(t.timeControl)}"></div>${roundCountField(t)}<div class="field"><label>Tournament type</label><select id="tournament-type" name="type">${["Swiss System", "Round Robin", "Knockout", "Team Swiss", "Team Round Robin"].map((x) => `<option ${t.type === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>${teamSettingsFields(t)}</div><div class="toolbar" style="justify-content:flex-end;margin-top:22px"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">Save tournament</button></div></form></section></div>`;
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
  const leaders = isTeamTournament()
    ? teamStandings(
        state.teams || [],
        state.rounds,
        state.tournament.teamScoring || "2-1-0",
      )
        .slice(0, 3)
        .map((entry) => ({
          rank: entry.rank,
          name: entry.team.name,
          score:
            state.tournament.teamScoring === "board-points"
              ? entry.boardPoints.toFixed(1)
              : String(entry.matchPoints),
        }))
    : standings(state.players, state.rounds)
        .slice(0, 3)
        .map((entry) => ({
          rank: entry.rank,
          name: entry.player.name,
          score: entry.points.toFixed(1),
        }));
  return `<div class="modal-backdrop"><section class="modal finish-modal" role="dialog" aria-modal="true" aria-labelledby="finish-title" data-modal><div class="finish-icon">♛</div><span class="eyebrow">Final round complete</span><h2 id="finish-title">End ${h(state.tournament.name)}?</h2><p class="muted">This certifies the current standings as the final rankings and locks result entry. Tournament details will remain available for export.</p><div class="finish-preview">${leaders.map((entry, index) => `<div class="finish-rank-${index + 1}"><span>${entry.rank}</span><b>${h(entry.name)}</b><strong>${entry.score}</strong></div>`).join("")}</div><div class="toolbar" style="justify-content:center;margin-top:22px"><button class="btn gold" data-action="confirm-end-tournament">${icon("trophy")} Publish final rankings</button><button class="btn" data-action="close-modal">Not yet</button></div></section></div>`;
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
      return `<article class="event-card ${active ? "active" : ""}"><button class="event-main" data-switch-tournament="${t.id}" ${active ? 'aria-current="true"' : ""}><span class="event-mark">${t.finished ? "♛" : "♞"}</span><span><b>${h(t.name)}</b><small>${h(t.venue)} · ${h(t.date)}</small><small>${t.type.startsWith("Team") ? `${(event.teams || []).filter((team) => team.active).length} teams` : `${event.players.length} players`} · ${event.rounds.length}/${t.totalRounds} rounds · ${completed} results</small></span>${active ? '<span class="pill">Current</span>' : icon("chevron-right")}</button><button class="icon-btn event-delete" data-delete-tournament="${t.id}" aria-label="Delete ${h(t.name)}" ${events.length === 1 ? "disabled" : ""}>${icon("trash-2")}</button></article>`;
    })
    .join(
      "",
    )}</div><div class="toolbar" style="margin-top:18px"><button class="btn primary" data-action="new-from-library">${icon("plus")} New tournament</button><button class="btn" data-action="restore">${icon("upload")} Import backup</button></div></section></div>`;
}
function playerOutcome(
  game: Round["pairings"][number],
  playerId: string,
): { label: string; score: string; tone: string } {
  if (!game.result) return { label: "Pending", score: "—", tone: "pending" };
  if (game.result === "BYE") return { label: "Bye", score: "1.0", tone: "win" };
  if (game.result === "½-½")
    return { label: "Draw", score: "0.5", tone: "draw" };
  const playerIsWhite = game.whiteId === playerId;
  const whiteWon = game.result === "1-0" || game.result === "1F-0F";
  const won = playerIsWhite === whiteWon;
  return {
    label: won ? "Win" : "Loss",
    score: won ? "1.0" : "0.0",
    tone: won ? "win" : "loss",
  };
}

function profileModal(id: string) {
  const s = standings(state.players, state.rounds).find(
    (x) => x.player.id === id,
  );
  const p = player(id);
  if (!p) return "";
  const games = state.rounds.flatMap((round) =>
    round.pairings
      .filter((game) => game.whiteId === id || game.blackId === id)
      .map((game) => ({ round: round.number, game })),
  );
  return `<div class="modal-backdrop"><section class="modal player-results-modal" role="dialog" aria-modal="true" aria-labelledby="player-results-title" data-modal><div class="modal-head"><div class="player-result-identity">${avatarMarkup(p, true)}<div><span class="eyebrow">Individual results</span><h2 id="player-results-title">${h(p.name)}</h2><span class="muted">${p.rating} · Age ${p.age || "—"} · ${h(p.ageCategory || categoryForAge(p.age))} · ${p.club ? h(p.club) : p.country ? countryFlag(p.country) : "Independent"}</span></div></div><button class="icon-btn" data-action="close-modal" aria-label="Close">${icon("x")}</button></div><div class="metrics player-result-metrics"><div class="metric"><b>${s?.points.toFixed(1) || "0.0"}</b><span>Points</span></div><div class="metric"><b>${s?.wins || 0}</b><span>Wins</span></div><div class="metric"><b>${s?.draws || 0}</b><span>Draws</span></div><div class="metric"><b>${s?.losses || 0}</b><span>Losses</span></div></div><section class="player-results"><div class="player-results-heading"><div><span class="eyebrow">Round-by-round record</span><h3>Tournament results</h3></div><span class="pill">${games.length} ${games.length === 1 ? "game" : "games"}</span></div>${
    games.length
      ? `<div class="table-wrap"><table class="player-results-table"><thead><tr><th>Round</th><th>Board</th><th>Color</th><th>Opponent</th><th>Result</th><th>Score</th></tr></thead><tbody>${games
          .map(({ round, game }) => {
            const isWhite = game.whiteId === id;
            const opponent = player(isWhite ? game.blackId : game.whiteId);
            const outcome = playerOutcome(game, id);
            return `<tr><td data-label="Round"><b>R${round}</b></td><td data-label="Board">${game.board}</td><td data-label="Color"><span class="color-chip ${game.blackId ? (isWhite ? "white" : "black") : "bye"}">${game.blackId ? (isWhite ? "White" : "Black") : "Bye"}</span></td><td data-label="Opponent">${opponent ? `<button class="result-opponent" data-player="${opponent.id}">${h(opponent.name)}</button>` : "—"}</td><td data-label="Result"><span class="outcome-badge ${outcome.tone}">${outcome.label}<small>${h(resultNotation(game.result))}</small></span></td><td class="score" data-label="Score">${outcome.score}</td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : '<div class="player-results-empty"><span>♙</span><b>No results recorded</b><p class="muted">This player’s games will appear here after pairings are created.</p></div>'
  }</section></section></div>`;
}
function activateProjector(): void {
  clearInterval(projectorTimer);
  projector = true;
  projectorSlide = 0;
  projectorTimer = window.setInterval(() => {
    projectorSlide = (projectorSlide + 1) % 3;
    render();
  }, 9000);
  document.documentElement.requestFullscreen?.().catch(() => {});
}

function deactivateProjector(): void {
  projector = false;
  clearInterval(projectorTimer);
  document.exitFullscreen?.().catch(() => {});
}

function projectorView() {
  const roundRobin = state.tournament.type === "Round Robin";
  const knockout = state.tournament.type === "Knockout";
  const competitionLabel = roundRobin
    ? "Round Robin Table"
    : knockout
      ? "Elimination Bracket"
      : `Round ${state.rounds.length} Pairings`;
  const labels = ["Live Standings", competitionLabel, "Tournament Overview"];
  let body = "";
  if (projectorSlide === 0)
    body = isTeamTournament()
      ? teamStandingsTable(
          teamStandings(
            state.teams || [],
            state.rounds,
            state.tournament.teamScoring || "2-1-0",
          ).slice(0, 12),
        )
      : standingsTable(standings(state.players, state.rounds).slice(0, 12));
  else if (projectorSlide === 1) {
    if (roundRobin) body = roundRobinTableView();
    else if (knockout) body = knockoutBracketView();
    else
      body = currentRound()
        ? `<div class="card">${currentRound()!
            .pairings.map((g) => board(g, currentRound()!))
            .join("")}</div>`
        : "<p>No pairings yet.</p>";
  } else
    body = `${metrics()}<div class="hero"><h2>${h(state.tournament.name)}</h2><p>${h(state.tournament.venue)} · ${h(state.tournament.date)}</p></div>`;
  return `<section class="projector"><button class="btn close-projector" data-action="projector-close">${icon("x")} Exit</button><span class="eyebrow">${h(state.tournament.name)}</span><h1>${labels[projectorSlide]}</h1><div class="projector-stage">${body}</div><div class="projector-controls" aria-label="Projector slides"><button class="btn" data-action="projector-prev" aria-label="Previous projector slide">${icon("chevron-left")} Previous</button><span>${projectorSlide + 1} / 3</span><button class="btn" data-action="projector-next" aria-label="Next projector slide">Next ${icon("chevron-right")}</button></div></section>`;
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
  if (state.view === "teams") content = teamsView();
  if (state.view === "pairings") content = pairingsView();
  if (state.view === "standings") content = standingsView();
  if (state.view === "history") content = historyView();
  if (state.view === "help") content = helpView();
  app.innerHTML = shell(content);
  enhanceRenderedUi();
}

// -----------------------------------------------------------------------------
// Tournament commands
// -----------------------------------------------------------------------------

function generatePairings(rounds: Round[]): Round["pairings"] {
  if (isTeamTournament())
    return generateTeamRound(
      state.tournament,
      state.players,
      state.teams || [],
      rounds,
    );
  if (state.tournament.type === "Round Robin")
    return generateRoundRobin(state.players, rounds);
  if (state.tournament.type === "Knockout")
    return generateKnockout(state.players, rounds);
  return generateSwiss(state.players, rounds);
}

function prepareAutomaticRound(allowAdvance = false): boolean {
  if (state.tournament.finished) return false;
  let changed = syncAutomaticRoundCount();
  const active = state.players.filter((player) => player.active);
  const activeTeams = (state.teams || []).filter((team) => team.active);
  if (isTeamTournament() ? activeTeams.length < 2 : active.length < 2)
    return changed;

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

/**
 * An untouched Round Robin opener is only a draft schedule. Rebuild it when
 * the roster changes so adding a third entrant after viewing Round 1 updates
 * both the derived round count and every pairing. Recorded results lock it.
 */
function refreshScheduleAfterRosterChange(): void {
  const rebuildRoundRobin =
    isRoundRobinTournament() &&
    state.rounds.length > 0 &&
    !roundRobinHasRecordedResults();
  if (rebuildRoundRobin) state.rounds = [];
  syncAutomaticRoundCount();
  if (rebuildRoundRobin) prepareAutomaticRound();
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
  let registrationBlocked = false;
  try {
    storage.savePlayer(data);
    if (registrationIndex >= 0) {
      state.players[registrationIndex] = { ...data };
      syncAutomaticRoundCount();
      storage.save(state);
    } else if (registerWithCurrentTournament) {
      if (isRoundRobinTournament() && roundRobinHasRecordedResults()) {
        registrationBlocked = true;
        toast(
          "Player profile saved, but Round Robin registration is locked after results are recorded.",
          "info",
        );
      } else {
        state.players.push({ ...data, active: true });
        refreshScheduleAfterRosterChange();
        storage.save(state);
      }
    }
    modal = "";
    if (!registrationBlocked)
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
function submitTeam(form: HTMLFormElement) {
  if (tournamentStarted()) {
    toast("Team rosters lock after Round 1 starts.", "error");
    return;
  }
  const data = new FormData(form);
  const id = String(data.get("id") || uid());
  const playerIds = data.getAll("playerIds").map(String);
  const size = state.tournament.teamSize || 4;
  if (playerIds.length !== size) {
    toast(`Choose exactly ${size} players for this team.`, "error");
    return;
  }
  const duplicate = (state.teams || [])
    .filter((team) => team.id !== id)
    .some((team) =>
      team.playerIds.some((playerId) => playerIds.includes(playerId)),
    );
  if (duplicate) {
    toast("A player can belong to only one team in this tournament.", "error");
    return;
  }
  const team: Team = {
    id,
    name: String(data.get("name")),
    playerIds,
    active: data.get("registerCurrent") === "on",
  };
  state.teams ||= [];
  const index = state.teams.findIndex((entry) => entry.id === id);
  if (index >= 0) state.teams[index] = team;
  else state.teams.push(team);
  for (const playerId of playerIds) {
    if (state.players.some((profile) => profile.id === playerId)) continue;
    const profile = storage
      .listPlayers()
      .find((candidate) => candidate.id === playerId);
    if (profile) state.players.push({ ...profile, active: true });
  }
  syncAutomaticRoundCount();
  modal = "";
  save(index >= 0 ? "Team updated" : "Team created");
  render();
}

function submitTournament(form: HTMLFormElement) {
  const creatingTournament = draftingNewTournament || !hasTournament;
  if (tournamentStarted()) {
    toast("Tournament settings cannot change after Round 1 starts.", "error");
    return;
  }
  const f = new FormData(form);
  const type = String(f.get("type")) as Tournament["type"];
  const playerCount = state.players.filter((profile) => profile.active).length;
  const teamCount = (state.teams || []).filter((team) => team.active).length;
  const teamSize = Number(f.get("teamSize") || state.tournament.teamSize || 4);
  const swiss = type === "Swiss System" || type === "Team Swiss";
  const entrantCount = isTeamTournament(type) ? teamCount : playerCount;
  const noRepeatMaximum = roundRobinRoundCount(entrantCount);
  const requestedRounds = Math.max(1, Number(f.get("totalRounds")) || 1);
  const scheduledRounds =
    swiss && noRepeatMaximum
      ? Math.min(requestedRounds, noRepeatMaximum)
      : requestedRounds;
  state.tournament = {
    ...state.tournament,
    name: String(f.get("name")),
    venue: String(f.get("venue")),
    organizer: String(f.get("organizer")),
    date: String(f.get("date")),
    timeControl: String(f.get("timeControl")),
    totalRounds:
      type === "Round Robin"
        ? roundRobinRoundCount(playerCount)
        : type === "Team Round Robin"
          ? roundRobinRoundCount(teamCount)
          : scheduledRounds,
    type,
    roundCountEntrants: swiss ? entrantCount : undefined,
    swissRoundsManual: swiss
      ? roundCountEdited || state.tournament.swissRoundsManual === true
      : undefined,
    teamSize,
    teamScoring: String(
      f.get("teamScoring") || state.tournament.teamScoring || "2-1-0",
    ) as TeamScoring,
  };
  if (isTeamTournament(type))
    state.teams = (state.teams || []).map((team) => ({
      ...team,
      active: team.active && team.playerIds.length === teamSize,
    }));
  hasTournament = true;
  draftingNewTournament = false;
  if (creatingTournament) state.view = "players";
  roundCountEdited = false;
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
    "[data-action],[data-view],[data-player],[data-edit-player],[data-delete-player],[data-add-to-tournament],[data-remove-from-tournament],[data-edit-team],[data-delete-team],[data-add-team],[data-remove-team],[data-switch-tournament],[data-delete-tournament],[data-result],[data-round],[data-export],[data-theme-choice],[data-layout-toggle]",
  );
  if (!el) return;
  if (el.dataset.themeChoice) {
    const theme = el.dataset.themeChoice as AppTheme;
    if (THEMES.includes(theme)) {
      applyTheme(theme);
      // Appearance is global, but changing it should not interrupt the
      // organizer's current task or move them to another tab.
      modal = "";
      render();
      document.querySelector<HTMLElement>("#main")?.focus();
    }
    return;
  }
  if (el.dataset.layoutToggle) {
    if (el.dataset.layoutToggle === "sidebar")
      layoutPreferences.hideSidebar = !layoutPreferences.hideSidebar;
    if (el.dataset.layoutToggle === "topbar")
      layoutPreferences.hideTopbar = !layoutPreferences.hideTopbar;
    saveLayoutPreferences();
    render();
    return;
  }
  // The backdrop closes a dialog only when it is clicked directly. Without
  // this guard, ordinary clicks inside a modal could bubble to its backdrop.
  if (el.classList.contains("modal-backdrop") && target !== el) return;
  const opensDialog =
    Boolean(
      el.dataset.player || el.dataset.editPlayer || el.dataset.editTeam,
    ) ||
    [
      "add-player",
      "add-team",
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
      syncAutomaticRoundCount();
      storage.save(state);
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
  if (el.dataset.editTeam) {
    modal = `team:${el.dataset.editTeam}`;
    render();
    return;
  }
  if (el.dataset.deleteTeam) {
    const team = (state.teams || []).find(
      (candidate) => candidate.id === el.dataset.deleteTeam,
    );
    if (team && confirm(`Delete ${team.name}?`)) {
      state.teams = (state.teams || []).filter((entry) => entry.id !== team.id);
      syncAutomaticRoundCount();
      save("Team deleted");
      render();
    }
    return;
  }
  if (el.dataset.addTeam || el.dataset.removeTeam) {
    const id = el.dataset.addTeam || el.dataset.removeTeam;
    const team = (state.teams || []).find((candidate) => candidate.id === id);
    if (team && !tournamentStarted()) {
      team.active = Boolean(el.dataset.addTeam);
      if (team.active)
        for (const playerId of team.playerIds) {
          if (state.players.some((profile) => profile.id === playerId))
            continue;
          const profile = storage
            .listPlayers()
            .find((candidate) => candidate.id === playerId);
          if (profile) state.players.push({ ...profile, active: true });
        }
      syncAutomaticRoundCount();
      save(team.active ? "Team added to tournament" : "Team removed");
      render();
    }
    return;
  }
  if (el.dataset.addToTournament) {
    const profile = storage
      .listPlayers()
      .find((candidate) => candidate.id === el.dataset.addToTournament);
    if (profile && !state.players.some((entry) => entry.id === profile.id)) {
      if (isRoundRobinTournament() && roundRobinHasRecordedResults()) {
        toast(
          "Round Robin registration is locked after results are recorded.",
          "error",
        );
        return;
      }
      state.players.push({ ...profile, active: true });
      refreshScheduleAfterRosterChange();
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
        (pairing) =>
          (pairing.whiteId === id || pairing.blackId === id) &&
          (!isRoundRobinTournament() || pairing.result !== null),
      ),
    );
    if (hasHistory) {
      toast(
        "This player has round history and cannot be unregistered.",
        "error",
      );
    } else {
      state.players = state.players.filter((entry) => entry.id !== id);
      refreshScheduleAfterRosterChange();
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
  const a = el.dataset.action;
  if (a === "show-sidebar") {
    layoutPreferences.hideSidebar = false;
    saveLayoutPreferences();
    render();
  } else if (a === "show-topbar") {
    layoutPreferences.hideTopbar = false;
    saveLayoutPreferences();
    render();
  } else if (a === "app-settings") {
    modal = "appearance";
    render();
  } else if (a === "add-player") {
    // Every Add Player entry point opens the same sheet and leaves the roster
    // visible underneath, so closing the form has a predictable destination.
    state.view = "players";
    modal = "player";
    render();
  } else if (a === "add-team") {
    state.view = "teams";
    modal = "team";
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
  } else if (a === "go-teams") {
    state.view = "teams";
    render();
  } else if (a === "go-pairings") {
    state.view = "pairings";
    prepareAndPersistAutomaticRound();
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
    activateProjector();
    render();
  } else if (a === "projector-prev" || a === "projector-next") {
    projectorSlide = (projectorSlide + (a === "projector-next" ? 1 : 2)) % 3;
    render();
  } else if (a === "projector-close") {
    deactivateProjector();
    render();
  }
});
app.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  // Hidden controls named "id" become named properties on HTMLFormElement and
  // can shadow form.id, so read the actual DOM attribute for dispatch.
  const formId = f.getAttribute("id");
  if (formId === "player-form") submitPlayer(f);
  if (formId === "team-form") submitTeam(f);
  if (formId === "tournament-form" || formId === "creation-form")
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
  if (t.id === "round-count-input") roundCountEdited = true;
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
  if (t.id === "tournament-type")
    updateRoundCountControls(t.value as Tournament["type"]);
  if (t.name === "playerIds" && t.type === "checkbox") {
    const selected = document.querySelectorAll<HTMLInputElement>(
      '#team-form [name="playerIds"]:checked',
    );
    const size = state.tournament.teamSize || 4;
    if (selected.length > size) {
      t.checked = false;
      toast(`Choose exactly ${size} players.`, "info");
    }
    const count = document.querySelectorAll<HTMLInputElement>(
      '#team-form [name="playerIds"]:checked',
    ).length;
    const output =
      document.querySelector<HTMLOutputElement>("#team-player-count");
    if (output) output.value = `${count} of ${size} selected`;
  }
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
        syncAutomaticRoundCount();
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

  const shortcut = (e.ctrlKey || e.metaKey) && e.altKey;
  if (shortcut) {
    const key = e.key.toLowerCase();
    if (["a", "d", "h", "l", "n", "p", "t"].includes(key)) {
      e.preventDefault();
      if (key === "p") {
        if (projector) deactivateProjector();
        else {
          modal = "";
          selectedPlayer = null;
          activateProjector();
        }
      } else if (key === "l") {
        layoutPreferences.hideSidebar = !layoutPreferences.hideSidebar;
        saveLayoutPreferences();
      } else if (key === "t") {
        layoutPreferences.hideTopbar = !layoutPreferences.hideTopbar;
        saveLayoutPreferences();
      } else if (key === "h" || key === "d") {
        if (projector) deactivateProjector();
        modal = "";
        selectedPlayer = null;
        state.view = key === "h" ? "help" : "dashboard";
      } else if (key === "a") {
        if (projector) deactivateProjector();
        selectedPlayer = null;
        modal = "appearance";
      } else if (key === "n") {
        if (projector) deactivateProjector();
        state.view = "players";
        selectedPlayer = null;
        modal = "player";
      }
      render();
      return;
    }
  }

  if (e.key === "Escape") {
    if (dialog) {
      requestModalClose();
      return;
    }
    exportOpen = false;
    if (projector) deactivateProjector();
    render();
  }
});
window.addEventListener("castling:saved", () => {
  const s = document.querySelector("#save-status");
  if (s) s.textContent = "Saved just now";
});
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js?v=45").then((registration) => {
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
