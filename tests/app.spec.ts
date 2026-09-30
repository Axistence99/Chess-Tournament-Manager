/** End-to-end coverage for first-run setup and the full tournament lifecycle. */
import { expect, test } from "@playwright/test";

async function clearAndOpen(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test("complete tournament lifecycle: create, register, pair, score, and finalize", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await clearAndOpen(page);
  await expect(page).toHaveTitle("Chest-Tournament Manager");
  await expect(page.locator(".creation-page")).toBeVisible();
  await expect(page.locator(".creation-identity img")).toBeVisible();
  await expect(page.locator(".hero h2")).toHaveCount(0);
  await page.fill('#creation-form [name="name"]', "Browser QA Open");
  await page.fill('#creation-form [name="venue"]', "QA Hall");
  await page.fill('#creation-form [name="organizer"]', "QA Organizer");
  await page.fill('#creation-form [name="totalRounds"]', "1");
  await page.click('#creation-form button[type="submit"]');

  await expect(page.getByText("Browser QA Open").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Player management" }),
  ).toBeVisible();
  await expect(page.locator("#player-form")).toHaveCount(0);
  for (const name of ["Papa", "XanjoFish", "Black Horse"]) {
    const row = page.locator("tbody tr", { hasText: name });
    await expect(row).toBeVisible();
    await row.locator("[data-add-to-tournament]").click();
  }

  await page.locator('.section-head [data-action="add-player"]').click();
  await page.fill('#player-form [name="name"]', "QA Player");
  await page.fill('#player-form [name="rating"]', "1500");
  await page.fill('#player-form [name="age"]', "20");
  await page.selectOption('#player-form [name="country"]', "USA");
  await page.click('[data-action="save-player-profile"]');
  await expect(
    page.getByText("4 registered for this tournament"),
  ).toBeVisible();

  await page.locator('.nav [data-view="standings"]').click();
  await expect(
    page.getByRole("heading", { name: "Starting Rank", exact: true }),
  ).toBeVisible();

  await page.locator('.nav [data-view="pairings"]').click();
  await expect(
    page.getByRole("heading", { name: "Round 1 pairings" }),
  ).toBeVisible();
  await expect(page.locator('[data-action="generate"]')).toHaveCount(0);
  await expect(page.locator('[data-action="lock"]')).toHaveCount(0);

  const boards = page.locator('.board-card [data-result="1-0"]');
  const boardCount = await boards.count();
  expect(boardCount).toBe(2);
  for (let index = 0; index < boardCount; index++)
    await boards.nth(index).click();

  await expect(page.locator('[data-action="end-tournament"]')).toBeVisible();
  await page.locator('[data-action="end-tournament"]').first().click();
  await page.locator('[data-action="confirm-end-tournament"]').click();

  await expect(
    page.getByRole("heading", { name: "Final Rank", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".podium-1")).toBeVisible();
  await expect(page.locator(".podium-2")).toBeVisible();
  await expect(page.locator(".podium-3")).toBeVisible();
  await expect(page.locator(".podium article").nth(1)).toHaveClass(/podium-1/);
  await expect(page.locator(".podium .avatar")).toHaveCount(0);

  await page.locator('.nav [data-view="dashboard"]').click();
  await expect(page.locator('[data-action="edit-tournament"]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test("player profile persists in directory and tournament storage", async ({
  page,
}) => {
  await clearAndOpen(page);
  await page.fill('#creation-form [name="name"]', "Persistence Open");
  await page.click('#creation-form button[type="submit"]');
  await page.locator('.nav [data-view="players"]').click();
  await page.locator('.section-head [data-action="add-player"]').click();
  await page.fill('#player-form [name="name"]', "Persistent Player");
  await page.fill('#player-form [name="rating"]', "1450");
  await page.fill('#player-form [name="age"]', "16");
  await page.click('[data-action="save-player-profile"]');
  await page.reload();
  await page.locator('.nav [data-view="players"]').click();
  await expect(
    page
      .locator(".table-wrap tbody tr")
      .filter({ has: page.getByRole("button", { name: /Persistent Player/ }) })
      .first(),
  ).toBeVisible();

  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("castling.library.v2") || "{}"),
  );
  expect(
    Object.values(persisted.players).some(
      (player: any) => player.name === "Persistent Player",
    ),
  ).toBe(true);
});
