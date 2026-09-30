// @vitest-environment happy-dom
/** Smoke tests for first-run creation, persistence, and dashboard rendering. */
import { beforeAll, describe, expect, it } from "vitest";

const tournamentId = "test-tournament";

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  localStorage.clear();
  localStorage.setItem(
    "castling.library.v2",
    JSON.stringify({
      version: 2,
      activeId: tournamentId,
      tournaments: {
        [tournamentId]: {
          tournament: {
            id: tournamentId,
            name: "Interaction Test Open",
            venue: "Test Hall",
            organizer: "",
            date: "2026-09-27",
            timeControl: "90+30",
            totalRounds: 5,
            type: "Swiss System",
            createdAt: new Date().toISOString(),
            finished: false,
          },
          players: [],
          rounds: [],
          view: "dashboard",
        },
      },
    }),
  );
  await import("./main");
  await new Promise((resolve) => setTimeout(resolve, 220));
});

describe("player creation interaction", () => {
  it("opens the Add Player sheet and submits a valid player", () => {
    document.querySelector<HTMLButtonElement>('[data-view="players"]')!.click();
    const openButton = document.querySelector<HTMLButtonElement>(
      '.section-head [data-action="add-player"]',
    );
    expect(openButton).not.toBeNull();
    openButton!.click();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const form = document.querySelector<HTMLFormElement>("#player-form");
    expect(dialog).not.toBeNull();
    expect(form).not.toBeNull();

    form!.querySelector<HTMLInputElement>('[name="name"]')!.value =
      "Ada Knight";
    form!.querySelector<HTMLInputElement>('[name="rating"]')!.value = "1700";
    form!.querySelector<HTMLInputElement>('[name="age"]')!.value = "15";
    form!
      .querySelector<HTMLButtonElement>('[data-action="save-player-profile"]')!
      .click();

    expect(document.body.textContent).toContain("Ada Knight");
    expect(document.body.textContent).toContain("U16");
    expect(document.body.textContent).toContain("Registered");
    expect(document.body.textContent).toContain(
      "1 registered for this tournament",
    );

    // Verify persistence independently of the rendered page.
    const saved = JSON.parse(localStorage.getItem("castling.library.v2")!);
    expect(Object.values(saved.players)).toHaveLength(6);
    expect(
      Object.values(saved.players).map((player: any) => player.name),
    ).toEqual(
      expect.arrayContaining([
        "XanjoFish",
        "Black Horse",
        "Joe",
        "Johnny",
        "Hana",
        "Ada Knight",
      ]),
    );
    expect(
      Object.values(saved.players).map((player: any) => player.name),
    ).not.toContain("Papa");
    expect(saved.players["preset-joe"]).toMatchObject({
      age: 19,
      rating: 1600,
    });
    expect(saved.players["preset-johnny"]).toMatchObject({
      age: 32,
      rating: 1590,
    });
    expect(saved.players["preset-hana"]).toMatchObject({
      age: 18,
      rating: 1642,
      avatar: "./profiles/hana.webp",
    });
    expect(saved.players["preset-xanjofish"]).toMatchObject({
      avatar: "./profiles/xanjofish.webp",
    });
    expect(saved.tournaments[tournamentId].players[0].name).toBe("Ada Knight");
  });
});
