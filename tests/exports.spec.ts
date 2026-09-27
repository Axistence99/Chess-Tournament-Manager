/** End-to-end validation of every browser-generated download format. */
import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { libraryWithCompletedTournament } from "./fixtures";

async function openFixture(page: Page) {
  await page.addInitScript((library) => {
    localStorage.setItem("castling.library.v2", JSON.stringify(library));
    localStorage.setItem("castling.player-presets.v1", "tested");
  }, libraryWithCompletedTournament());
  await page.goto("/");
  await expect(page.getByText("QA Championship").first()).toBeVisible();
}

async function exportFromMenu(page: Page, type: string): Promise<Download> {
  await page.locator('.topbar [data-action="toggle-export"]').click();
  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.locator(`[data-export="${type}"]`).click();
  return downloadPromise;
}

async function bytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path)
    throw new Error(`No file path for ${download.suggestedFilename()}`);
  return readFile(path);
}

test("PGN and all PDF reports download with valid signatures", async ({
  page,
}) => {
  await openFixture(page);

  const pgn = await bytes(await exportFromMenu(page, "pgn"));
  expect(pgn.toString()).toContain('[Event "QA Championship"]');
  expect(pgn.toString()).toContain('[Result "1-0"]');

  for (const type of ["pdf-standings", "pdf-pairings", "pdf-players"]) {
    const pdf = await bytes(await exportFromMenu(page, type));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1_000);
  }
});

test("PNG, JPG and tournament ZIP exports are generated in-browser", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openFixture(page);

  const png = await bytes(await exportFromMenu(page, "png"));
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

  const jpg = await bytes(await exportFromMenu(page, "jpg"));
  expect([...jpg.subarray(0, 2)]).toEqual([255, 216]);

  const zipBuffer = await bytes(await exportFromMenu(page, "zip"));
  expect(zipBuffer.subarray(0, 2).toString()).toBe("PK");
  const archive = await JSZip.loadAsync(zipBuffer);
  expect(Object.keys(archive.files)).toEqual(
    expect.arrayContaining([
      "Tournament.pgn",
      "Standings.pdf",
      "Pairings.pdf",
      "Standings.png",
      "Backup.json",
    ]),
  );
});

test("CSV and JSON backup exports contain tournament data", async ({
  page,
}) => {
  await openFixture(page);
  await page.locator('.nav [data-view="players"]').click();

  const csvPromise = page.waitForEvent("download");
  await page.locator('[data-action="export-csv"]').click();
  const csv = await bytes(await csvPromise);
  expect(csv.toString()).toContain("Name,Rating,Age");
  expect(csv.toString()).toContain("Alpha King");

  const backupPromise = page.waitForEvent("download");
  await page.locator('.topbar [data-action="backup"]').click();
  const backup = JSON.parse((await bytes(await backupPromise)).toString());
  expect(backup.tournament.name).toBe("QA Championship");
  expect(backup.rounds).toHaveLength(1);
});
