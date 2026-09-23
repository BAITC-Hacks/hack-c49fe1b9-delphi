import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

export const demoEmail = process.env.PLAYWRIGHT_EMAIL ?? "analyst@delphi.local";
export const demoPassword = process.env.DELPHI_DEMO_PASSWORD ?? "password123";

export const test = base.extend({
  page: async ({ page, baseURL }, runTest) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      if (!localStorage.getItem("delphi-ui-locale")) {
        localStorage.setItem("delphi-ui-locale", "en");
      }
    });
    try {
      await runTest(page);
    } finally {
      const response = await page.request.post("/api/auth/sign-out", {
        headers: { Origin: new URL(baseURL!).origin },
        data: {},
      });
      expect(response.ok(), "Test session cleanup must succeed").toBeTruthy();
      expect(pageErrors, "No uncaught browser errors").toEqual([]);
    }
  },
});

export { expect };

export async function signIn(page: Page) {
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").origin;
  const response = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email: demoEmail, password: demoPassword },
  });
  expect(response.status(), "Seeded demo account must authenticate").toBe(200);
}

type PageCapture = {
  slug: string;
  name: string;
  description: string;
  route?: string;
  dataSource: string;
};

export async function capturePage(page: Page, testInfo: TestInfo, details: PageCapture) {
  await page.evaluate(() => document.fonts.ready);
  const viewport = page.viewportSize();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `${details.name} must fit its viewport`).toBeLessThanOrEqual((viewport?.width ?? width) + 1);
  const url = new URL(page.url());
  const path = testInfo.outputPath(`${details.slug}.png`);
  await page.screenshot({
    path,
    fullPage: true,
    animations: "disabled",
    mask: [page.locator('input[type="password"]')],
  });
  await testInfo.attach(`page:${details.slug}`, { path, contentType: "image/png" });
  await testInfo.attach(`page-meta:${details.slug}`, { body: Buffer.from(JSON.stringify({
    ...details,
    route: details.route ?? `${url.pathname}${url.search}`,
    viewport,
  })), contentType: "application/json" });
}
