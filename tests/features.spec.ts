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
  await expect(page.locator(".board-card")).toHaveCount(2);

  await page.locator('.nav [data-view="players"]').click();
  await page
    .getByRole("button", { name: /Alpha King/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Alpha King");
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

  const semifinalResults = page.locator('.board-card [data-result="1-0"]');
  await expect(semifinalResults).toHaveCount(2);
  for (let index = 0; index < 2; index++)
    await semifinalResults.nth(index).click();

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
