/** Mobile regression tests for equal navigation sizing and active states. */
import { expect, test } from "@playwright/test";
import { libraryWithCompletedTournament } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((library) => {
    localStorage.setItem("castling.library.v2", JSON.stringify(library));
    localStorage.setItem("castling.player-presets.v1", "tested");
  }, libraryWithCompletedTournament());
  await page.goto("/");
});

async function expectStableNavigation(page: import("@playwright/test").Page) {
  const buttons = page.locator(".mobile-nav button");
  await expect(buttons).toHaveCount(5);
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

test("bottom navigation remains equal-sized and highlights Pairings and Rounds", async ({
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
});
