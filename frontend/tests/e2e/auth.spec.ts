import { test, expect, capturePage, demoEmail, demoPassword } from "../support/fixtures";

const live = "Live local Better Auth and PostgreSQL";

test("sign-in validation, real session and sign-out protection", async ({ page }, info) => {
  await page.goto("/new");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await capturePage(page, info, {
    slug: "sign-in", name: "Sign in", dataSource: live,
    description: "Protected pages redirect to the email/password sign-in screen.",
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Email", { exact: true }).fill(demoEmail);
  await page.getByLabel("Password", { exact: true }).fill("incorrect-e2e-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/" || url.pathname === "/new");
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await page.request.get("/backend/api/analyses")).status()).toBe(401);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("registration page validates fields and preserves entered values", async ({ page }, info) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Test User");
  await page.getByLabel("Email", { exact: true }).fill("invalid-email");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Test User");
  await capturePage(page, info, {
    slug: "sign-up", name: "Create account", dataSource: "Real frontend form validation; no account created",
    description: "Registration shows field errors without losing entered values. Passwords are masked in screenshots.",
  });
});
