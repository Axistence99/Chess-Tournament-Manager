/** End-to-end interaction coverage for themes, formats, restore, and projector UI. */
import { expect, test } from "@playwright/test";
import {
  completedTournament,
  libraryWithCompletedTournament,
} from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((library) => {
    localStorage.setItem("castling.library.v2", JSON.stringify(library));
    localStorage.setItem("castling.player-presets.v1", "tested");
  }, libraryWithCompletedTournament());
  await page.goto("/");
});

test("round history, player profile, projector and tournament chooser are interactive", async ({
  page,
}) => {
  await page.locator('.nav [data-view="history"]').click();
  await expect(page.getByRole("button", { name: /Round 1/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Round 1 results" }),
  ).toBeVisible();
  await expect(page.locator(".archived-board")).toHaveCount(2);
  await expect(page.locator(".archived-result")).toHaveCount(2);

  await page.locator('.nav [data-view="players"]').click();
  await page
    .getByRole("button", { name: /Alpha King/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Alpha King");
  await expect(
    page.getByRole("heading", { name: "Tournament results" }),
  ).toBeVisible();
  await expect(page.locator(".player-results-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".outcome-badge")).toContainText(
    /Win|Draw|Loss|Bye/,
  );
  await page.keyboard.press("Escape");

  await page.locator('.sidebar [data-action="projector"]').click();
  await expect(page.locator(".projector")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".projector")).toHaveCount(0);

  await page.locator('[data-action="choose-tournament"]').click();
  await expect(
    page.getByRole("heading", { name: "Choose tournament" }),
  ).toBeVisible();
});

test("appearance settings switch and persist all three themes", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Appearance/ }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a theme" }),
  ).toBeVisible();

  await page.getByRole("radio", { name: /Light/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('.nav [data-view="dashboard"]')).toHaveClass(
    /active/,
  );

  await page.getByRole("button", { name: /Appearance/ }).click();
  await page.getByRole("radio", { name: /The Criterion/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "criterion");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "criterion");

  await page.getByRole("button", { name: /Appearance/ }).click();
  await page.getByRole("radio", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('.nav [data-view="dashboard"]')).toHaveClass(
    /active/,
  );
});

test("CSV import and JSON restore persist new local records", async ({
  page,
}) => {
  await page.locator('.nav [data-view="players"]').click();
  await page.locator("#csv-file").setInputFiles({
    name: "players.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Name,Rating,Age,Club,Federation,FIDE ID\nCSV Knight,1550,18,Import Club,PHI,999",
    ),
  });
  await expect(
    page.locator("tbody tr", { hasText: "CSV Knight" }).first(),
  ).toBeVisible();

  const restored = structuredClone(completedTournament);
  restored.tournament.name = "Restored Championship";
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#restore-file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restored)),
  });
  await expect(page.getByText("Restored Championship").first()).toBeVisible();

  const count = await page.evaluate(() => {
    const library = JSON.parse(
      localStorage.getItem("castling.library.v2") || "{}",
    );
    return Object.keys(library.tournaments || {}).length;
  });
  expect(count).toBe(2);
});

test("three-player Swiss uses a two-round recommendation", async ({ page }) => {
  const swiss = structuredClone(completedTournament);
  swiss.tournament.name = "Three Player Swiss";
  swiss.tournament.type = "Swiss System";
  swiss.tournament.totalRounds = 5;
  delete swiss.tournament.roundCountEntrants;
  swiss.tournament.finished = false;
  swiss.players = swiss.players.slice(0, 3);
  swiss.rounds = [];
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#restore-file").setInputFiles({
    name: "three-player-swiss.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(swiss)),
  });

  await page.locator('[data-action="edit-tournament"]').click();
  await expect(page.locator("#round-count-input")).toHaveValue("2");
  await expect(page.locator("#round-count-input")).toHaveAttribute("max", "3");
  await expect(page.locator("#round-count-help")).toContainText(
    "Recommended: 2 rounds for 3 players",
  );
});

test("round robin rounds are derived from the player count", async ({
  page,
}) => {
  const roundRobin = structuredClone(completedTournament);
  roundRobin.tournament.name = "Automatic Round Robin";
  roundRobin.tournament.type = "Round Robin";
  roundRobin.tournament.totalRounds = 99;
  roundRobin.tournament.finished = false;
  roundRobin.rounds = [];
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#restore-file").setInputFiles({
    name: "automatic-round-robin.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(roundRobin)),
  });

  await page.locator('[data-action="edit-tournament"]').click();
  await expect(page.locator("#round-count-input")).toBeHidden();
  await expect(page.locator("#round-count-input")).toBeDisabled();
  await expect(page.locator("#round-count-output")).toHaveText(
    "3 rounds for 4 players",
  );
  await expect(
    page.getByText(/Every player meets every other player once/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator('.nav [data-view="players"]').click();
  await page.locator(".registration.registered").first().click();
  await page.locator(".registration.registered").first().click();
  await page.locator('.nav [data-view="dashboard"]').click();
  await page.locator('[data-action="edit-tournament"]').click();
  await expect(page.locator("#round-count-output")).toHaveText(
    "1 round for 2 players",
  );

  // Merely viewing the automatically generated opener must not freeze the
  // schedule. Adding a third player rebuilds the untouched Round Robin draw.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator('.nav [data-view="pairings"]').click();
  await expect(
    page.getByRole("heading", { name: "Round 1 pairings" }),
  ).toBeVisible();
  await page.locator('.nav [data-view="players"]').click();
  await page.locator(".registration:not(.registered)").first().click();
  await page.locator('.nav [data-view="dashboard"]').click();
  await expect(
    page.locator(".metric", { hasText: "Current round" }),
  ).toContainText("1 / 3");
});

test("round robin format renders a responsive crosstable", async ({ page }) => {
  const roundRobin = structuredClone(completedTournament);
  roundRobin.tournament.name = "Round Robin QA";
  roundRobin.tournament.type = "Round Robin";
  roundRobin.tournament.totalRounds = 3;
  roundRobin.tournament.finished = false;
  roundRobin.view = "dashboard";
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#restore-file").setInputFiles({
    name: "round-robin.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(roundRobin)),
  });

  await page.locator('.nav [data-view="pairings"]').click();
  await expect(
    page.getByRole("heading", { name: "Round Robin table" }),
  ).toBeVisible();
  await expect(page.locator(".round-robin-table tbody tr")).toHaveCount(4);
  await expect(page.locator(".round-robin-table .rr-self")).toHaveCount(4);
  await expect(page.locator(".round-robin-table .rr-result")).toHaveCount(4);
  await expect(page.locator(".round-robin-scroll")).toBeVisible();

  await page.locator('.sidebar [data-action="projector"]').click();
  await page.getByRole("button", { name: "Next projector slide" }).click();
  await expect(
    page.locator(".projector h1", { hasText: "Round Robin Table" }),
  ).toBeVisible();
  await expect(page.locator(".projector .round-robin-table")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("team tournament groups boards and applies the selected team scoring", async ({
  page,
}) => {
  const teamEvent = structuredClone(completedTournament);
  teamEvent.tournament.name = "Team Round Robin QA";
  teamEvent.tournament.type = "Team Round Robin";
  teamEvent.tournament.teamSize = 2;
  teamEvent.tournament.teamScoring = "3-1-0";
  teamEvent.tournament.totalRounds = 99;
  teamEvent.tournament.finished = false;
  teamEvent.rounds = [];
  teamEvent.teams = [
    {
      id: "team-green",
      name: "Green Knights",
      playerIds: teamEvent.players.slice(0, 2).map((player) => player.id),
      active: true,
    },
  ];
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#restore-file").setInputFiles({
    name: "team-event.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(teamEvent)),
  });

  await expect(page.locator('.nav [data-view="teams"]')).toBeVisible();
  await page.locator('.nav [data-view="teams"]').click();
  await expect(page.locator(".team-card")).toHaveCount(1);
  const greenTeam = page.locator(".team-card", { hasText: "Green Knights" });
  await greenTeam.locator(".registration").click();
  await greenTeam.locator(".registration").click();

  await page.locator('[data-action="add-team"]').click();
  await page.locator('#team-form [name="name"]').fill("Gold Bishops");
  for (const profile of teamEvent.players.slice(2, 4)) {
    await page
      .locator("#team-form .team-player-option", { hasText: profile.name })
      .click();
  }
  await page.locator('#team-form button[type="submit"]').click();
  await expect(page.locator(".team-card")).toHaveCount(2);
  await expect(
    page
      .locator(".team-card", { hasText: "Gold Bishops" })
      .locator(".registered"),
  ).toBeVisible();

  await page.locator('.nav [data-view="pairings"]').click();
  await expect(page.locator(".team-match-card")).toHaveCount(1);
  await expect(page.locator(".team-match-card .board-card")).toHaveCount(2);
  await page.locator('.board-card [data-result="1-0"]').first().click();
  await page.locator('.board-card [data-result="0-1"]').last().click();
  await page.locator('.nav [data-view="standings"]').click();
  await expect(
    page.getByRole("heading", { name: "Team standings" }),
  ).toBeVisible();
  await expect(
    page.locator(".content .team-ranking-table tbody tr"),
  ).toHaveCount(2);
  await expect(
    page.locator(".content .team-ranking-table tbody tr").first(),
  ).toContainText("3");
});

test("team formats, team size, and scoring are available during creation", async ({
  page,
}) => {
  await page.locator('[data-action="choose-tournament"]').click();
  await page.locator('[data-action="new-from-library"]').click();
  await page.locator('[data-action="confirm-new"]').click();
  await expect(
    page
      .locator("#tournament-type")
      .getByRole("option", { name: "Team Swiss" }),
  ).toHaveCount(1);
  await expect(
    page
      .locator("#tournament-type")
      .getByRole("option", { name: "Team Round Robin" }),
  ).toHaveCount(1);
  await page.locator("#tournament-type").selectOption("Team Round Robin");
  await expect(page.locator('[name="teamSize"]')).toBeVisible();
  await expect(page.locator('[name="teamScoring"] option')).toHaveCount(3);
  await expect(page.locator("#round-count-output")).toContainText(
    "at least 2 teams",
  );
});

test("knockout format generates and advances a seeded bracket", async ({
  page,
}) => {
  const knockout = structuredClone(completedTournament);
  knockout.tournament.name = "Knockout QA";
  knockout.tournament.type = "Knockout";
  knockout.tournament.totalRounds = 5;
  knockout.tournament.finished = false;
  knockout.rounds = [];
  knockout.view = "dashboard";
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#restore-file").setInputFiles({
    name: "knockout.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(knockout)),
  });

  await page.locator('.nav [data-view="pairings"]').click();
  await expect(
    page.getByRole("heading", { name: "Semifinal bracket" }),
  ).toBeVisible();
  await expect(page.locator('[data-action="generate"]')).toHaveCount(0);
  await expect(page.locator('[data-action="lock"]')).toHaveCount(0);
  await expect(page.locator(".knockout-bracket .bracket-round")).toHaveCount(2);
  await expect(page.locator(".knockout-bracket")).toHaveClass(
    /compact-bracket/,
  );
  await expect(page.locator(".knockout-bracket .bracket-match")).toHaveCount(3);
  await expect(page.locator(".bracket-connectors path")).toHaveCount(1);
  await expect(page.locator(".championship-round")).toContainText("Winner 1.1");
  await expect(page.locator('.board-card [data-result="½-½"]')).toHaveCount(0);

  await page.locator('.sidebar [data-action="projector"]').click();
  await page.getByRole("button", { name: "Next projector slide" }).click();
  await expect(
    page.locator(".projector h1", { hasText: "Elimination Bracket" }),
  ).toBeVisible();
  await expect(page.locator(".projector .knockout-bracket")).toBeVisible();
  await page.keyboard.press("Escape");

  const semifinalResults = page.locator('.board-card [data-result="1-0"]');
  await expect(semifinalResults).toHaveCount(2);
  for (let index = 0; index < 2; index++)
    await semifinalResults.nth(index).click();

  await expect(
    page.getByRole("heading", { name: "Semifinal bracket" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue to Round 2", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Continue to Round 2?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create Round 2", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Final bracket" }),
  ).toBeVisible();
  await page.locator('.board-card [data-result="1-0"]').click();
  await page.getByRole("button", { name: "End tournament" }).click();
  await page.getByRole("button", { name: /Publish final rankings/ }).click();
  await expect(
    page.getByRole("heading", { name: "Final Rank", exact: true }),
  ).toBeVisible();
});
