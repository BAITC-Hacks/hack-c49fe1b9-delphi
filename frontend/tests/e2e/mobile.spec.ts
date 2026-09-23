import { test, expect, capturePage, signIn } from "../support/fixtures";
import {
  installResultRoutes,
  originalAfterQuote,
  originalBeforeQuote,
  resultDataSource,
  resultIds,
  transferTitle,
} from "../fixtures/results";

test("mobile navigation, notifications and persistent RU/KK/EN selection", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Analysis history", exact: true })).toBeVisible();
  await capturePage(page, info, {
    slug: "mobile-history", name: "Mobile history", dataSource: "Real frontend and authentication; live history request",
    description: "The history shell fits a 390-pixel mobile viewport; this navigation check does not validate backend availability or saved history content.",
  });
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible();
  await capturePage(page, info, {
    slug: "mobile-navigation", name: "Mobile navigation", dataSource: "Real frontend navigation and authenticated session",
    description: "The side sheet exposes history, new comparison and sign-out on small screens.",
  });
  await menu.getByRole("link", { name: "New comparison", exact: true }).click();
  await expect(menu).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "New comparison", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("log")).toHaveText("No new events");
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "Interface language", exact: true }).click();
  await page.getByRole("option", { name: "ҚАЗ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Жаңа салыстыру", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Жаңа салыстыру", exact: true })).toBeVisible();
  await capturePage(page, info, {
    slug: "mobile-new-kk", name: "New comparison — Kazakh mobile UI", dataSource: "Real frontend locale persistence",
    description: "The Kazakh interface persists after reload, including mobile form and navigation labels.",
  });
  await page.getByRole("combobox", { name: "Интерфейс тілі", exact: true }).click();
  await page.getByRole("option", { name: "RU", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Новое сравнение", exact: true })).toBeVisible();
});

test("mobile review queue keeps deep-linked evidence reachable outside filters", async ({ page }, info) => {
  await signIn(page);
  const fixture = await installResultRoutes(page);
  await page.goto(`/analyses/${resultIds.analysis}?view=review&change=potentially_missing&finding=${resultIds.transfer}`);
  const queue = page.getByRole("region", { name: "Review queue", exact: true });
  const evidence = queue.getByRole("region", { name: "Finding evidence" });
  await expect(evidence.getByRole("heading", { name: transferTitle, exact: true })).toBeVisible();
  await expect(evidence.getByText(originalBeforeQuote, { exact: true })).toBeVisible();
  await expect(evidence.getByText(originalAfterQuote, { exact: true })).toBeVisible();
  await capturePage(page, info, {
    slug: "mobile-review-evidence", name: "Mobile analysis · Linked evidence", dataSource: resultDataSource,
    description: "A linked finding stays readable on a narrow screen even when the queue filter excludes it; original quotations and human review remain available.",
  });
  await queue.getByRole("button", { name: "Back to queue", exact: true }).click();
  await expect(page).not.toHaveURL(/finding=/);
  await expect(evidence).toBeHidden();
  await expect(queue.getByRole("textbox", { name: "Search review queue", exact: true })).toBeVisible();
  await queue.getByRole("button", { name: new RegExp(fixture.findings[2].title) }).click();
  await expect(evidence.getByRole("heading", { name: fixture.findings[2].title, exact: true })).toBeVisible();
  await expect(evidence.getByText("No confirmed After counterpart is recorded", { exact: true })).toBeVisible();
  expect(fixture.unhandled).toEqual([]);
});
