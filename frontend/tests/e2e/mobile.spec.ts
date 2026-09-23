import { test, expect, capturePage, signIn } from "../support/fixtures";

test("mobile navigation, notifications and persistent RU/KK/EN selection", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Comparison history", exact: true })).toBeVisible();
  await capturePage(page, info, {
    slug: "mobile-history", name: "Mobile history", dataSource: "Live local FastAPI and PostgreSQL",
    description: "Comparison history remains usable on a 390-pixel mobile viewport.",
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
