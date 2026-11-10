import { describe, expect, it } from "vitest";
import { isSafeAvatarSource, validateBackup } from "./backupValidation";

const validBackup = () => ({
  tournament: {
    id: "event-1",
    name: "Club Open",
    venue: "Main Hall",
    organizer: "Chess Club",
    date: "2026-09-27",
    timeControl: "15+10",
    totalRounds: 1,
    type: "Swiss System",
    createdAt: "2026-09-27T00:00:00.000Z",
    finished: false,
  },
  players: [
    {
      id: "player-1",
      name: "White Player",
      rating: 1500,
      age: 20,
      club: "",
      country: "PHI",
      fideId: "",
      ageCategory: "Open",
      active: true,
    },
    {
      id: "player-2",
      name: "Black Player",
      rating: 1450,
      age: 21,
      club: "",
      country: "PHI",
      fideId: "",
      ageCategory: "Open",
      active: true,
    },
  ],
  rounds: [
    {
      number: 1,
      pairings: [
        {
          id: "game-1",
          board: 1,
          whiteId: "player-1",
          blackId: "player-2",
          result: null,
          locked: true,
        },
      ],
      locked: true,
      completed: false,
      createdAt: "2026-09-27T00:00:00.000Z",
    },
  ],
  view: "pairings",
});

describe("backup validation", () => {
  it("accepts and independently rebuilds a valid tournament backup", () => {
    const source = validBackup();
    const result = validateBackup(source);
    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    expect(result.players[0]).not.toBe(source.players[0]);
  });

  it("migrates the legacy manual-crosstable name", () => {
    const source = validBackup();
    source.tournament.type = "Manual Crosstable";
    expect(validateBackup(source).tournament.type).toBe(
      "Round Robin manual crosstable",
    );
  });

  it("rejects injected enum values, attribute-breaking dates, and unsafe IDs", () => {
    const typeAttack = validBackup();
    typeAttack.tournament.type = '<img src=x onerror="alert(1)">';
    expect(() => validateBackup(typeAttack)).toThrow("Invalid backup file");

    const dateAttack = validBackup();
    dateAttack.tournament.date = '2026-09-27\" autofocus';
    expect(() => validateBackup(dateAttack)).toThrow("Invalid backup file");

    const idAttack = validBackup();
    idAttack.players[0].id = "__proto__";
    expect(() => validateBackup(idAttack)).toThrow("Invalid backup file");
  });

  it("rejects remote, SVG, and oversized avatar sources", () => {
    expect(isSafeAvatarSource("https://example.com/avatar.png")).toBe(false);
    expect(isSafeAvatarSource("data:image/svg+xml;base64,PHN2Zz4=")).toBe(
      false,
    );
    expect(isSafeAvatarSource("./profiles/hana.webp")).toBe(true);
    expect(
      isSafeAvatarSource(`data:image/jpeg;base64,${"A".repeat(512 * 1024)}`),
    ).toBe(false);
  });

  it("rejects pairings that reference players absent from the backup", () => {
    const source = validBackup();
    source.rounds[0].pairings[0].blackId = "missing-player";
    expect(() => validateBackup(source)).toThrow("Invalid backup file");
  });
});
