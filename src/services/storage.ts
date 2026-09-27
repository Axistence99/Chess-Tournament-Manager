import type { AppState, Player } from "../models";

/**
 * One browser library owns two related data sets:
 * - reusable player profiles
 * - tournaments containing snapshots of the profiles registered for that event
 *
 * Tournament snapshots deliberately preserve historical ratings and names. A
 * profile edit updates active registrations, while completed exports remain
 * reproducible from each tournament's stored state.
 */
interface TournamentLibrary {
  version: 3;
  activeId: string;
  tournaments: Record<string, AppState>;
  players: Record<string, Player>;
}

const LIBRARY_KEY = "castling.library.v2";
const LEGACY_KEY = "castling.tournament.v1";

function readLibrary(): TournamentLibrary | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIBRARY_KEY) || "null") as
      | (Partial<TournamentLibrary> & {
          tournaments?: Record<string, AppState>;
        })
      | null;
    if (!parsed) return null;

    const tournaments = parsed.tournaments || {};
    const players: Record<string, Player> = { ...(parsed.players || {}) };
    // Version 2 stored players only inside tournaments. Promote each unique
    // profile into the reusable directory without changing tournament history.
    for (const event of Object.values(tournaments)) {
      for (const profile of event.players || []) {
        if (!players[profile.id]) players[profile.id] = { ...profile };
      }
    }
    return {
      version: 3,
      activeId: parsed.activeId || Object.keys(tournaments)[0] || "",
      tournaments,
      players,
    };
  } catch {
    return null;
  }
}

function writeLibrary(library: TournamentLibrary): void {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
}

function blankLibrary(activeId = ""): TournamentLibrary {
  return { version: 3, activeId, tournaments: {}, players: {} };
}

export const storage = {
  /** Load the last selected tournament, migrating the original single-event format. */
  load(): AppState | null {
    const library = readLibrary();
    if (library)
      return (
        library.tournaments[library.activeId] ||
        Object.values(library.tournaments)[0] ||
        null
      );

    try {
      const legacy = JSON.parse(
        localStorage.getItem(LEGACY_KEY) || "null",
      ) as AppState | null;
      if (legacy?.tournament?.id) {
        const migrated = blankLibrary(legacy.tournament.id);
        migrated.tournaments[legacy.tournament.id] = legacy;
        for (const profile of legacy.players)
          migrated.players[profile.id] = { ...profile };
        writeLibrary(migrated);
        localStorage.removeItem(LEGACY_KEY);
      }
      return legacy;
    } catch {
      return null;
    }
  },

  /** Insert or update a tournament and synchronize its registered profiles. */
  save(state: AppState): void {
    const library = readLibrary() || blankLibrary(state.tournament.id);
    library.activeId = state.tournament.id;
    library.tournaments[state.tournament.id] = state;
    for (const profile of state.players)
      library.players[profile.id] = { ...profile };
    writeLibrary(library);
    window.dispatchEvent(new CustomEvent("castling:saved"));
  },

  /** Return independent events, newest first, for the tournament chooser. */
  list(): AppState[] {
    return Object.values(readLibrary()?.tournaments || {}).sort((a, b) =>
      b.tournament.createdAt.localeCompare(a.tournament.createdAt),
    );
  },

  /** Return the reusable player directory, independent of tournament entry. */
  listPlayers(): Player[] {
    return Object.values(readLibrary()?.players || {}).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  },

  /** Create or update one global profile and active, unfinished registrations. */
  savePlayer(profile: Player): void {
    const library = readLibrary() || blankLibrary();
    library.players[profile.id] = { ...profile };
    for (const event of Object.values(library.tournaments)) {
      if (event.tournament.finished) continue;
      const index = event.players.findIndex(
        (player) => player.id === profile.id,
      );
      if (index >= 0) event.players[index] = { ...profile };
    }
    writeLibrary(library);
  },

  /** Delete a directory profile only when no tournament references it. */
  removePlayer(id: string): boolean {
    const library = readLibrary();
    if (!library) return true;
    const inUse = Object.values(library.tournaments).some((event) =>
      event.players.some((player) => player.id === id),
    );
    if (inUse) return false;
    delete library.players[id];
    writeLibrary(library);
    return true;
  },

  /** Select a stored event without mutating its tournament data. */
  select(id: string): AppState | null {
    const library = readLibrary();
    const selected = library?.tournaments[id] || null;
    if (library && selected) {
      library.activeId = id;
      writeLibrary(library);
    }
    return selected;
  },

  /** Delete one event. Player profiles remain available for other events. */
  remove(id: string): void {
    const library = readLibrary();
    if (!library) return;
    delete library.tournaments[id];
    if (library.activeId === id)
      library.activeId = Object.keys(library.tournaments)[0] || "";
    writeLibrary(library);
  },

  backup(state: AppState): void {
    download(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
      `${slug(state.tournament.name)}-backup.json`,
    );
  },

  async restore(file: File): Promise<AppState> {
    const data = JSON.parse(await file.text()) as AppState;
    if (
      !data.tournament ||
      !Array.isArray(data.players) ||
      !Array.isArray(data.rounds)
    )
      throw Error("Invalid backup file");
    data.tournament.id = crypto.randomUUID();
    data.tournament.createdAt = new Date().toISOString();
    return data;
  },
};

export function download(blob: Blob, name: string): void {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "tournament";
