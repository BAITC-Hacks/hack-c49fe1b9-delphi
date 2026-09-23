import { readFile } from "node:fs/promises";
import { test, expect, capturePage, signIn } from "../support/fixtures";
import {
  installResultRoutes,
  originalAfterQuote,
  originalBeforeQuote,
  resultDataSource,
  resultIds,
  transferTitle,
} from "../fixtures/results";

const resultPath = `/analyses/${resultIds.analysis}`;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("structure mappings preserve source context and source navigation", async ({
  page,
}, testInfo) => {
  const fixture = await installResultRoutes(page);
  await page.goto(`${resultPath}?tab=structure`);
  await expect(
    page.getByRole("heading", { name: fixture.analysis.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Structure", exact: true }),
  ).toHaveAttribute("data-state", "active");
  const row = page.getByRole("row").filter({ hasText: "Transformed" });
  await expect(row).toContainText("Отдел аудита");
  await expect(row).toContainText("Служба контроля");
  await capturePage(page, testInfo, {
    slug: "results-structure",
    name: "Analysis · Structure",
    description:
      "Before/after unit mappings link each structural change to its original source clauses.",
    dataSource: resultDataSource,
  });

  await row.getByRole("button", { name: "Source 1", exact: true }).click();
  const source = page.getByRole("dialog", { name: "Original source · 1.1" });
  await expect(
    source.getByText(originalBeforeQuote, { exact: true }),
  ).toBeVisible();
  await expect(
    source.getByText("Parent clause 1", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`source=${resultIds.beforeSource}`));
  await capturePage(page, testInfo, {
    slug: "results-source-context",
    name: "Analysis · Original source and parent context",
    description:
      "The source panel keeps original Russian quotations, parent clauses and neighbouring-block navigation.",
    dataSource: resultDataSource,
  });
  await source.getByRole("button", { name: "Previous block" }).click();
  await expect(
    page.getByRole("dialog", { name: "Original source · 1", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(fixture.unhandled).toEqual([]);
});

test("findings support URL filters, evidence, review persistence and report exports", async ({
  page,
}, testInfo) => {
  const fixture = await installResultRoutes(page);
  await page.goto(resultPath);
  await expect(
    page.getByRole("button", { name: transferTitle, exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Change type" }).click();
  await page.getByRole("option", { name: "Transferred", exact: true }).click();
  await expect(page).toHaveURL(/change=transferred/);
  await expect(page.getByText("Showing: 1 / 3", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Возможное пересечение ответственности",
      exact: true,
    }),
  ).toHaveCount(0);
  await capturePage(page, testInfo, {
    slug: "results-findings-filter",
    name: "Analysis · Functions and risks",
    description:
      "Searchable findings use shareable URL filters for change type, issues, review status and units.",
    dataSource: resultDataSource,
  });

  await page.getByRole("button", { name: "Reset filters" }).click();
  await page
    .getByRole("textbox", { name: "Search function or clause number" })
    .fill("1.1");
  await expect(page).toHaveURL(/q=1.1/);
  await expect(page.getByText("Showing: 3 / 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: transferTitle, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`finding=${resultIds.transfer}`));
  await page.reload();
  const evidence = page.getByRole("region", { name: "Finding evidence" });
  await expect(
    evidence.getByText(originalBeforeQuote, { exact: true }),
  ).toBeVisible();
  await expect(
    evidence.getByText(originalAfterQuote, { exact: true }),
  ).toBeVisible();
  await capturePage(page, testInfo, {
    slug: "results-finding-evidence",
    name: "Analysis · Finding evidence and human review",
    description:
      "A deep-linked finding shows original before/after quotations and a separate human-review form.",
    dataSource: resultDataSource,
  });

  const note =
    "Verified with both department owners.\nQuarterly responsibility is retained.";
  await evidence.getByRole("combobox", { name: "Decision" }).click();
  await page.getByRole("option", { name: "Confirmed", exact: true }).click();
  await evidence.getByRole("textbox", { name: "Note", exact: true }).fill(note);
  await evidence.getByRole("button", { name: "Save review" }).click();
  await expect(
    evidence.getByRole("button", { name: "Save review" }),
  ).toBeDisabled();
  await expect.poll(() => fixture.run.review_revision).toBe(1);
  expect(fixture.findings[0].review).toMatchObject({
    status: "confirmed",
    note,
  });
  expect(fixture.findings[0].explanation).toContain("изменён исполнитель");
  await page.reload();
  await expect(
    evidence.getByRole("textbox", { name: "Note", exact: true }),
  ).toHaveValue(note);
  await expect(evidence.getByRole("combobox", { name: "Decision" })).toHaveText(
    "Confirmed",
  );
  await page.getByRole("tab", { name: "Conclusion", exact: true }).click();
  const report = page.frameLocator('iframe[title="Report preview"]');
  await expect(
    report.getByText("Review revision: 1", { exact: true }),
  ).toBeVisible();
  await expect(
    report.getByText("Review status: confirmed", { exact: true }),
  ).toBeVisible();
  await expect(report.locator("pre")).toHaveText(note);
  await expect(
    page.getByText("Original report: RU", { exact: true }),
  ).toBeVisible();
  expect(fixture.translations).toHaveLength(0);
  await capturePage(page, testInfo, {
    slug: "results-reviewed-conclusion",
    name: "Analysis · Reviewed conclusion and exports",
    description:
      "The report reflects the saved human review and stays available in its original language before translation.",
    dataSource: resultDataSource,
  });

  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  const html = await htmlDownload;
  expect(html.suggestedFilename()).toBe(`delphi-${resultIds.run}-ru.html`);
  const htmlContent = await readFile((await html.path())!, "utf8");
  expect(htmlContent).toContain("Review revision: 1");
  expect(htmlContent).toContain(originalBeforeQuote);
  expect(htmlContent).toContain(note);
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toBe(`delphi-${resultIds.run}-en.csv`);
  const csvContent = await readFile((await csv.path())!, "utf8");
  expect(csvContent).toContain(resultIds.beforeSource);
  expect(csvContent).toContain("Отдел аудита");
  expect(fixture.unhandled).toEqual([]);
});

test("language changes do not run AI and explicit translations expire after review changes", async ({
  page,
}, testInfo) => {
  const fixture = await installResultRoutes(page);
  await page.goto(`${resultPath}?tab=conclusion`);
  await expect(
    page.getByText("Original report: RU", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Report preview"]')
      .getByText("Report language: RU", { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Interface language" }).click();
  await page.getByRole("option", { name: "ҚАЗ", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Қорытынды", exact: true }),
  ).toBeVisible();
  expect(fixture.translations).toHaveLength(0);
  await page.getByRole("combobox", { name: "Интерфейс тілі" }).click();
  await page.getByRole("option", { name: "EN", exact: true }).click();
  await page
    .getByRole("button", { name: "Translate explanations", exact: true })
    .click();
  await expect(
    page.getByText("Translated report: EN", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Report preview"]')
      .getByText("Report language: EN", { exact: true }),
  ).toBeVisible();
  expect(fixture.translations).toHaveLength(1);
  await capturePage(page, testInfo, {
    slug: "results-translated-conclusion",
    name: "Analysis · Explicit saved-result translation",
    description:
      "Translation is requested explicitly; translated reports preserve original source quotations and review revision.",
    dataSource: resultDataSource,
  });

  await page
    .getByRole("tab", { name: "Functions and risks", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Recommendation monitoring transferred to Control Service",
      exact: true,
    })
    .click();
  const evidence = page.getByRole("region", { name: "Finding evidence" });
  await expect(
    evidence.getByText(originalBeforeQuote, { exact: true }),
  ).toBeVisible();
  await expect(
    evidence.getByText(originalAfterQuote, { exact: true }),
  ).toBeVisible();
  await evidence
    .getByRole("textbox", { name: "Note", exact: true })
    .fill("New review revision requires a fresh translation.");
  await evidence.getByRole("button", { name: "Save review" }).click();
  await expect(
    page.getByRole("button", { name: "Translate explanations", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => fixture.run.review_revision).toBe(1);
  await page.getByRole("tab", { name: "Conclusion", exact: true }).click();
  await expect(
    page.getByText("Original report: RU", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Report preview"]')
      .getByText("Review revision: 1", { exact: true }),
  ).toBeVisible();
  expect(fixture.translations).toHaveLength(1);
  expect(
    fixture.requests.filter((request) => request.method === "POST"),
  ).toEqual([
    {
      method: "POST",
      path: `/api/runs/${resultIds.run}/translations`,
      search: "",
    },
  ]);
  expect(fixture.unhandled).toEqual([]);
});

test("active runs poll and failed runs explain why results are unavailable", async ({
  page,
}, testInfo) => {
  const fixture = await installResultRoutes(page, "running");
  fixture.run.coverage.processed_sources = 1;
  fixture.run.coverage.compared_before_functions = 0;
  await page.goto(resultPath);
  await expect(
    page.getByText("You can return later. Run progress is saved.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Functions and risks" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Repeat in a new draft" }),
  ).toBeDisabled();
  await capturePage(page, testInfo, {
    slug: "results-running",
    name: "Analysis · Running",
    description:
      "An active run shows its current stage and coverage while polling for completion; unavailable findings are hidden.",
    dataSource: resultDataSource,
  });
  fixture.run.state = "failed";
  fixture.run.stage = "failed";
  fixture.run.errors = [
    "Synthetic fixture: provider unavailable; no result saved.",
  ];
  fixture.run.finished_at = "2026-09-23T08:01:00Z";
  await expect(
    page.getByText(fixture.run.errors[0], { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "A usable result was not produced. Review the errors above and create a new draft to retry.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Repeat in a new draft" }),
  ).toBeEnabled();
  await expect(page.getByRole("tab", { name: "Conclusion" })).toHaveCount(0);
  await capturePage(page, testInfo, {
    slug: "results-failed",
    name: "Analysis · Failed run and coverage",
    description:
      "Failure details and incomplete coverage are visible, with a new-draft retry action instead of invented results.",
    dataSource: resultDataSource,
  });
  expect(
    fixture.requests.filter((request) => request.path.endsWith("/findings")),
  ).toHaveLength(0);
  expect(fixture.unhandled).toEqual([]);
});

test("invalid finding links and empty filters have explicit recoverable states", async ({
  page,
}) => {
  const fixture = await installResultRoutes(page);
  await page.goto(`${resultPath}?finding=unknown-finding`);
  await expect(
    page.getByText(
      "The linked finding does not belong to this analysis or no longer exists.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page).not.toHaveURL(/finding=/);
  await page
    .getByRole("textbox", { name: "Search function or clause number" })
    .fill("no-such-function-fixture");
  await expect(
    page.getByText("No findings match these filters.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(
    page.getByRole("button", { name: transferTitle, exact: true }),
  ).toBeVisible();
  expect(fixture.unhandled).toEqual([]);
});
