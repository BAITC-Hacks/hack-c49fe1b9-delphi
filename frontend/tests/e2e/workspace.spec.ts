import { randomUUID } from "node:crypto";
import type { AnalysisDetail, AnalysisListItem, AnalysisResponse, DocumentResponse, SourceResponse } from "../../src/shared/api/generated";
import { removeSyntheticDraft, syntheticDraftPrefix } from "../support/cleanup";
import { capturePage, expect, signIn, test } from "../support/fixtures";

const officialTitle = "Демо DOCX: сравнение редакций внутреннего аудита 8 и 9";
const officialData = "Live local PostgreSQL and FastAPI; official DOCX seed";
const syntheticData = "Live local PostgreSQL and FastAPI; explicitly synthetic uploaded Markdown, removed after this test";

test("official history, parsing consent and exact source preview", async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Comparison history", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: officialTitle, exact: true })).toBeVisible();
  await capturePage(page, testInfo, {
    slug: "comparison-history",
    name: "Comparison history",
    description: "Saved comparisons from PostgreSQL with draft status, search, status filtering and navigation.",
    dataSource: officialData,
  });

  await page.getByRole("textbox", { name: "Search by title" }).fill("No comparison with this exact synthetic search");
  await expect(page.getByText("No matching comparisons", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search by title" }).fill("внутреннего аудита");
  await expect(page.getByRole("link", { name: officialTitle, exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by status" }).click();
  await page.getByRole("option", { name: "Draft", exact: true }).click();
  await page.getByRole("link", { name: officialTitle, exact: true }).click();
  await expect(page.getByRole("heading", { name: officialTitle, exact: true })).toBeVisible();

  const analysisId = new URL(page.url()).searchParams.get("analysis");
  expect(analysisId).toBeTruthy();
  const detailResponse = await page.request.get(`/backend/api/analyses/${analysisId}`);
  expect(detailResponse.status()).toBe(200);
  const analysis: AnalysisDetail = await detailResponse.json();
  expect(analysis.run).toBeNull();
  expect(analysis.documents).toHaveLength(2);
  expect(analysis.documents.every((document) => document.parse_status === "partial" && document.block_count > 0)).toBe(true);

  const startAnalysis = page.getByRole("button", { name: "Start analysis", exact: true });
  const consent = page.getByRole("checkbox", { name: "I reviewed the limitations and allow a partial analysis" });
  await expect(page.getByText("The documents have parsing limitations", { exact: true })).toBeVisible();
  await expect(page.getByText(/Referenced annex text is missing/).first()).toBeVisible();
  await expect(startAnalysis).toBeDisabled();
  await consent.check();
  await expect(startAnalysis).toBeEnabled();
  await consent.uncheck();
  await expect(startAnalysis).toBeDisabled();
  await capturePage(page, testInfo, {
    slug: "official-draft",
    name: "Official DOCX comparison draft",
    description: "Revision 8 and 9 input files, parsing warnings and required consent for a partial analysis. No AI run is started.",
    dataSource: officialData,
  });

  const before = analysis.documents.find((document) => document.side === "before")!;
  const sourceResponse = await page.request.get(`/backend/api/analyses/${analysis.id}/documents/${before.id}/sources`);
  expect(sourceResponse.status()).toBe(200);
  const sources: SourceResponse[] = await sourceResponse.json();
  expect(sources).toHaveLength(before.block_count);
  const quotedSource = sources.find((source) => source.clause_no && source.original_text.length > 60 && source.original_text.length < 500)!;
  expect(quotedSource).toBeTruthy();
  await page.getByRole("article").filter({ has: page.getByRole("heading", { name: before.filename, exact: true }) }).getByRole("button", { name: "Preview", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: before.filename, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Search source text" }).fill(quotedSource.original_text.trim());
  await expect(dialog.getByText(quotedSource.original_text, { exact: true }).first()).toHaveText(quotedSource.original_text);
  await capturePage(page, testInfo, {
    slug: "original-source-preview",
    name: "Original source preview",
    description: "Searchable original Russian wording and clause identifiers remain intact while the interface is in English.",
    dataSource: officialData,
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("create a draft, upload both sides, revise, move and remove documents", async ({ page }, testInfo) => {
  await signIn(page);
  const title = `${syntheticDraftPrefix} browser upload ${randomUUID()}`;
  let analysisId: string | undefined;
  try {
    await page.goto("/new");
    await expect(page.getByRole("heading", { name: "New comparison", exact: true })).toBeVisible();
    await capturePage(page, testInfo, {
      slug: "new-comparison",
      name: "New comparison",
      description: "A named draft starts the Before/After document preparation workflow.",
      dataSource: "Live local application; empty form before creating a synthetic test draft",
    });
    await page.getByRole("textbox", { name: "Comparison title" }).fill(title);
    const createdResponse = page.waitForResponse((response) => response.url().endsWith("/backend/api/analyses") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Continue to documents" }).click();
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const analysis: AnalysisResponse = await created.json();
    analysisId = analysis.id;
    await expect(page).toHaveURL(new RegExp(`/new\\?analysis=${analysisId}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

    const beforeQuote = "1.1. Служба аудита проверяет ежегодный план — без изменения исходной цитаты.";
    const files = [
      { side: "before", name: "E2E-SYNTHETIC-before.md", text: `# E2E SYNTHETIC — test input, not an official document\n1. Обязанности\n${beforeQuote}\n` },
      { side: "after", name: "E2E-SYNTHETIC-after.md", text: "# E2E SYNTHETIC — test input, not an official document\n1. Обязанности\n1.1. Отдел контроля проверяет ежегодный план.\n" },
    ] as const;
    const startAnalysis = page.getByRole("button", { name: "Start analysis", exact: true });
    await expect(startAnalysis).toBeDisabled();
    for (const file of files) {
      await page.locator(`#upload-${file.side}`).setInputFiles({ name: file.name, mimeType: "text/markdown", buffer: Buffer.from(file.text, "utf8") });
      const document = page.getByRole("article").filter({ has: page.getByRole("heading", { name: file.name, exact: true }) });
      await expect(document.getByText("Parsed", { exact: true })).toBeVisible();
      await expect(page.locator(`#upload-${file.side}`)).toBeEnabled();
    }
    await expect(startAnalysis).toBeEnabled();

    const beforeCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: files[0].name, exact: true }) });
    await beforeCard.getByRole("textbox", { name: "Revision label" }).fill("Synthetic revision 1");
    const revisionSaved = page.waitForResponse((response) => response.url().includes(`/backend/api/analyses/${analysisId}/documents/`) && response.request().method() === "PATCH");
    await beforeCard.getByRole("button", { name: "Save revision label" }).click();
    expect((await revisionSaved).status()).toBe(200);
    await expect(beforeCard.getByRole("button", { name: "Save revision label" })).toBeDisabled();
    const refreshed = await page.request.get(`/backend/api/analyses/${analysisId}`);
    const saved: AnalysisDetail = await refreshed.json();
    const beforeDocument: DocumentResponse = saved.documents.find((document) => document.side === "before")!;
    expect(beforeDocument.revision_label).toBe("Synthetic revision 1");

    await beforeCard.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: files[0].name, exact: true });
    await expect(preview.getByText(beforeQuote, { exact: true })).toHaveText(beforeQuote);
    await preview.getByRole("button", { name: "Close", exact: true }).click();
    await capturePage(page, testInfo, {
      slug: "prepared-synthetic-draft",
      name: "Prepared Before/After documents",
      description: "Real Markdown uploads, saved revision labels and parsed source counts; both sides are ready without calling AI.",
      dataSource: syntheticData,
    });

    await beforeCard.getByRole("button", { name: "Move to After", exact: true }).click();
    await expect(beforeCard.getByRole("button", { name: "Move to Before", exact: true })).toBeVisible();
    await expect(startAnalysis).toBeDisabled();
    await beforeCard.getByRole("button", { name: "Move to Before", exact: true }).click();
    await expect(beforeCard.getByRole("button", { name: "Move to After", exact: true })).toBeVisible();
    await expect(startAnalysis).toBeEnabled();

    await beforeCard.getByRole("button", { name: "Remove document", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Remove document?", exact: true });
    await expect(confirmation.getByText(files[0].name, { exact: true })).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(beforeCard).toBeVisible();
    await beforeCard.getByRole("button", { name: "Remove document", exact: true }).click();
    await confirmation.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(beforeCard).toHaveCount(0);
    await expect(startAnalysis).toBeDisabled();

    await page.getByRole("button", { name: "Notifications", exact: true }).click();
    const notifications = page.getByRole("log");
    await expect(notifications.getByText("Draft saved", { exact: true })).toBeVisible();
    await expect(notifications.getByText("Document removed from draft", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(notifications.getByText("No new events", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    if (analysisId) await removeSyntheticDraft(page.request, analysisId, title);
  }
  const historyResponse = await page.request.get("/backend/api/analyses");
  expect(historyResponse.status()).toBe(200);
  const history: AnalysisListItem[] = await historyResponse.json();
  expect(history.some((analysis) => analysis.id === analysisId)).toBe(false);
  expect(history.some((analysis) => analysis.title === officialTitle)).toBe(true);
});
