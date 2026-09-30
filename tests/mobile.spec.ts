/** Mobile regression tests for equal navigation sizing and active states. */
import { expect, test } from "@playwright/test";
import {
  completedTournament,
  libraryWithCompletedTournament,
} from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((library) => {
    // Keep one reusable profile outside the tournament to exercise the mobile
    // registration action without relying on seeded browser data.
    library.players["mobile-spare"] = {
      id: "mobile-spare",
      name: "Mobile Reserve Player",
      rating: 1450,
      age: 20,
      club: "Touch Club",
      country: "PHI",
      fideId: "5",
      ageCategory: "Open",
      active: true,
    };
    localStorage.setItem("castling.library.v2", JSON.stringify(library));
    localStorage.setItem("castling.player-presets.v1", "tested");
  }, libraryWithCompletedTournament());
  await page.goto("/");
});

async function expectStableNavigation(page: import("@playwright/test").Page) {
  const buttons = page.locator(".mobile-nav button");
  await expect(buttons).toHaveCount(6);
  const boxes = await buttons.evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  expect(
    Math.max(...boxes.map((box) => box.width)) -
      Math.min(...boxes.map((box) => box.width)),
  ).toBeLessThan(1);
  expect(new Set(boxes.map((box) => box.height)).size).toBe(1);

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test("player registration uses cards without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator('.mobile-nav [data-view="players"]').click();

  await expect(page.locator(".players-table tbody tr")).toHaveCount(5);
  const reserve = page
    .locator(".players-table tbody tr")
    .filter({ hasText: "Mobile Reserve Player" });
  await expect(reserve).toBeVisible();
  const registration = reserve.getByRole("button", {
    name: "Add to tournament",
  });
  await expect(registration).toBeVisible();

  const layout = await page.evaluate(() => {
    const button = document
      .querySelector<HTMLElement>("[data-add-to-tournament]")!
      .getBoundingClientRect();
    const list = document
      .querySelector<HTMLElement>(".players-table-wrap")!
      .getBoundingClientRect();
    return {
      pageOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      buttonLeft: button.left,
      buttonRight: button.right,
      listLeft: list.left,
      listRight: list.right,
      viewport: window.innerWidth,
    };
  });
  expect(layout.pageOverflow).toBeLessThanOrEqual(1);
  expect(layout.buttonLeft).toBeGreaterThanOrEqual(layout.listLeft);
  expect(layout.buttonRight).toBeLessThanOrEqual(layout.listRight);
  expect(layout.listRight).toBeLessThanOrEqual(layout.viewport);
});

test("round robin uses compact tables and standings stay within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const roundRobin = structuredClone(completedTournament);
  roundRobin.tournament.name = "Mobile Round Robin";
  roundRobin.tournament.type = "Round Robin";
  roundRobin.tournament.totalRounds = 3;
  roundRobin.tournament.finished = false;
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#restore-file").setInputFiles({
    name: "mobile-round-robin.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(roundRobin)),
  });

  await page.locator('.mobile-nav [data-view="pairings"]').click();
  await expect(page.locator(".round-robin-scroll")).toBeHidden();
  await expect(page.locator(".rr-mobile-tables")).toBeVisible();
  await expect(page.locator(".rr-mobile-standings tbody tr")).toHaveCount(4);
  await expect(page.locator(".rr-mobile-schedule tbody tr")).toHaveCount(2);
  await expectStableNavigation(page);

  await page.locator('.mobile-nav [data-view="standings"]').click();
  await expect(page.locator(".content .mobile-ranking-list")).toBeVisible();
  await expect(page.locator(".content .mobile-rank-card")).toHaveCount(4);
  await expect(page.locator(".content .mobile-rank-card .avatar")).toHaveCount(
    0,
  );
  await expectStableNavigation(page);
});

test("all primary tabs remain inside the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const view of [
    "dashboard",
    "players",
    "pairings",
    "standings",
    "history",
    "help",
  ]) {
    await page.locator(`.mobile-nav [data-view="${view}"]`).click();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(
      overflow,
      `${view} should not overflow horizontally`,
    ).toBeLessThanOrEqual(1);
  }
});

test("bottom navigation remains equal-sized and highlights Pairings, Rounds, and Help", async ({
  page,
}) => {
  await page.locator('.mobile-nav [data-view="pairings"]').click();
  await expect(
    page.locator('.mobile-nav [data-view="pairings"]'),
  ).toHaveAttribute("aria-current", "page");
  await expectStableNavigation(page);

  await page.locator('.mobile-nav [data-view="history"]').click();
  await expect(
    page.locator('.mobile-nav [data-view="history"]'),
  ).toHaveAttribute("aria-current", "page");
  await expectStableNavigation(page);

  await page.locator('.mobile-nav [data-view="help"]').click();
  await expect(page.locator('.mobile-nav [data-view="help"]')).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("heading", { name: "Help & tournament guide" }),
  ).toBeVisible();
  await expectStableNavigation(page);
});
