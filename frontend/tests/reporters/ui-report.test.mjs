import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import UiReport, { redact } from "./ui-report.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=", "base64");

function scenario(title = "Report preview", outcome = "expected") {
  return {
    id: title,
    title,
    titlePath: () => ["", "desktop-chromium", title],
    outcome: () => outcome,
    parent: { project: () => ({ name: "desktop-chromium", use: { viewport: { width: 1440, height: 1000 } } }) },
  };
}

function createReporter(context, scenarios) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "delphi-ui-report-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const reporter = new UiReport({ outputDir: directory });
  reporter.onBegin({}, { allTests: () => scenarios });
  return { reporter, directory };
}

function attachment(overrides = {}) {
  return {
    name: "page:report-preview",
    contentType: "image/png",
    body: png,
    ...overrides,
  };
}

function metadataAttachment(overrides = {}) {
  return {
    name: "page-meta:report-preview",
    contentType: "application/json",
    body: Buffer.from(JSON.stringify({
      slug: "report-preview",
      name: "Report | preview",
      description: "Saved report with source links",
      route: "/analyses/synthetic-id?tab=report&access_token=never-export-this",
      dataSource: "Mocked synthetic result fixture; real local authentication",
      viewport: { width: 390, height: 844 },
    })),
    ...overrides,
  };
}

test("report copies screenshots, preserves provenance and uses portable relative links", (context) => {
  const current = scenario();
  const { reporter, directory } = createReporter(context, [current]);
  reporter.onTestEnd(current, { status: "passed", retry: 0, attachments: [attachment(), metadataAttachment()], errors: [] });
  reporter.onEnd({ status: "passed", duration: 1520 });

  const report = JSON.parse(readFileSync(path.join(directory, "latest.json"), "utf8"));
  const markdown = readFileSync(path.join(directory, "latest.md"), "utf8");
  assert.equal(report.status, "passed");
  assert.equal(report.tests[0].status, "passed");
  assert.equal(report.captures[0].viewport, "390 × 844");
  assert.equal(report.captures[0].route, "/analyses/synthetic-id?tab=report");
  assert.deepEqual(readFileSync(path.join(directory, report.captures[0].screenshot)), png);
  assert.match(markdown, /Report \\\| preview/);
  assert.match(markdown, /Mocked synthetic result fixture/);
  assert.match(markdown, /do not validate live AI/);
  assert.match(markdown, /\[Open screenshot\]\(screenshots\//);
  assert.match(markdown, /!\[Report/);
  assert.doesNotMatch(markdown, /never-export-this/);
  assert.doesNotMatch(markdown, new RegExp(directory));
});

test("an unavailable screenshot is reported and makes report generation fail", (context) => {
  const current = scenario();
  const { reporter, directory } = createReporter(context, [current]);
  reporter.onTestEnd(current, { status: "passed", retry: 0, attachments: [attachment({ body: undefined, path: path.join(directory, "missing.png") }), metadataAttachment()], errors: [] });
  assert.deepEqual(reporter.onEnd({ status: "passed", duration: 2 }), { status: "failed" });

  const report = JSON.parse(readFileSync(path.join(directory, "latest.json"), "utf8"));
  const markdown = readFileSync(path.join(directory, "latest.md"), "utf8");
  assert.equal(report.status, "failed");
  assert.equal(report.captures[0].screenshot, undefined);
  assert.match(markdown, /Screenshot artifact could not be copied/);
  assert.doesNotMatch(markdown, /!\[/);
});

test("a new or interrupted run never shows stale captures as current", (context) => {
  const current = scenario();
  const { reporter, directory } = createReporter(context, [current]);
  reporter.onTestEnd(current, { status: "passed", retry: 0, attachments: [attachment(), metadataAttachment()], errors: [] });
  reporter.onEnd({ status: "passed", duration: 1 });
  const previous = JSON.parse(readFileSync(path.join(directory, "latest.json"), "utf8"));

  const next = new UiReport({ outputDir: directory });
  next.onBegin({}, { allTests: () => [current] });
  const pending = JSON.parse(readFileSync(path.join(directory, "latest.json"), "utf8"));
  assert.equal(pending.status, "running");
  assert.equal(pending.tests[0].status, "not run");
  assert.deepEqual(pending.captures, []);
  assert.notEqual(pending.runId, previous.runId);
  assert.equal(existsSync(path.join(directory, previous.captures[0].screenshot)), true);
  next.onEnd({ status: "interrupted", duration: 0 });
  assert.match(readFileSync(path.join(directory, "latest.md"), "utf8"), /\*\*interrupted\*\*/);
  assert.equal(readdirSync(path.join(directory, "screenshots")).length, 2);
});

test("failure artifacts survive test cleanup and credentials are redacted", (context) => {
  const current = scenario("Evidence review", "unexpected");
  const { reporter, directory } = createReporter(context, [current]);
  const previousSecret = process.env.DELPHI_REPORT_TEST_SECRET;
  process.env.DELPHI_REPORT_TEST_SECRET = "a-private-test-secret";
  context.after(() => {
    if (previousSecret === undefined) delete process.env.DELPHI_REPORT_TEST_SECRET;
    else process.env.DELPHI_REPORT_TEST_SECRET = previousSecret;
  });
  reporter.onTestEnd(current, {
    status: "failed",
    retry: 0,
    attachments: [attachment({ name: "screenshot" }), { name: "trace", contentType: "application/zip", body: Buffer.from("never-copy-traces") }],
    errors: [{ message: 'Expected review to save\nAuthorization: Bearer hidden-bearer\nCookie: session=hidden-session\n{"password": "hidden-password"}\na-private-test-secret\npostgresql://user:hidden-db-password@localhost/db' }],
  });
  reporter.onEnd({ status: "failed", duration: 10 });

  for (const file of ["latest.md", "latest.json"]) {
    const contents = readFileSync(path.join(directory, file), "utf8");
    assert.match(contents, /Expected review to save/);
    assert.match(contents, /redacted/);
    assert.doesNotMatch(contents, /hidden-bearer|hidden-session|hidden-password|a-private-test-secret|hidden-db-password|never-copy-traces/);
  }
  const report = JSON.parse(readFileSync(path.join(directory, "latest.json"), "utf8"));
  assert.equal(report.tests[0].status, "failed");
  assert.equal(report.captures.length, 1);
  assert.equal(report.captures[0].viewport, "1440 × 1000");
  assert.equal(report.captures[0].dataSource, "Unspecified; automatic failure capture");
});

test("invalid metadata is visible instead of silently dropping the capture", (context) => {
  const current = scenario();
  const { reporter, directory } = createReporter(context, [current]);
  reporter.onTestEnd(current, { status: "passed", retry: 0, attachments: [attachment(), metadataAttachment({ body: Buffer.from("{invalid") })], errors: [] });
  assert.deepEqual(reporter.onEnd({ status: "passed", duration: 2 }), { status: "failed" });
  assert.match(readFileSync(path.join(directory, "latest.md"), "utf8"), /Invalid page attachment metadata/);
});

test("long descriptions stay in metadata instead of screenshot filenames", (context) => {
  const current = scenario();
  const { reporter, directory } = createReporter(context, [current]);
  const metadata = metadataAttachment();
  const value = JSON.parse(metadata.body.toString());
  value.description = "A complete explanation of the saved report state. ".repeat(30);
  metadata.body = Buffer.from(JSON.stringify(value));
  reporter.onTestEnd(current, { status: "passed", retry: 0, attachments: [metadata, attachment()], errors: [] });
  reporter.onEnd({ status: "passed", duration: 1 });
  const report = JSON.parse(readFileSync(path.join(directory, "latest.json"), "utf8"));
  assert.equal(report.captures[0].description, value.description);
  assert.ok(path.basename(report.captures[0].screenshot).length < 150);
  assert.ok(existsSync(path.join(directory, report.captures[0].screenshot)));
  assert.ok(attachment().name.length < 100);
});

test("missing companion metadata is reported without claiming data provenance", (context) => {
  const current = scenario();
  const { reporter, directory } = createReporter(context, [current]);
  reporter.onTestEnd(current, { status: "passed", retry: 0, attachments: [attachment()], errors: [] });
  assert.deepEqual(reporter.onEnd({ status: "passed", duration: 2 }), { status: "failed" });
  const report = JSON.parse(readFileSync(path.join(directory, "latest.json"), "utf8"));
  assert.equal(report.captures[0].dataSource, "Unspecified; missing page metadata");
  assert.equal(report.captures[0].route, "Unavailable");
  assert.match(report.captures[0].description, /Invalid page attachment metadata/);
});

test("failure before test startup still writes a current report", (context) => {
  const { directory } = createReporter(context, []);
  const outputDir = path.join(directory, "early-failure");
  const reporter = new UiReport({ outputDir });
  reporter.onError({ message: "Test discovery failed" });
  reporter.onEnd({ status: "failed", duration: 0 });
  const report = JSON.parse(readFileSync(path.join(outputDir, "latest.json"), "utf8"));
  assert.equal(report.status, "failed");
  assert.deepEqual(report.tests, []);
  assert.deepEqual(report.captures, []);
  assert.deepEqual(report.errors, ["Test discovery failed"]);
});

test("retry captures retain their attempt status while the test is marked flaky", (context) => {
  const current = scenario("Retrying evidence", "flaky");
  const { reporter, directory } = createReporter(context, [current]);
  reporter.onTestEnd(current, { status: "failed", retry: 0, attachments: [attachment(), metadataAttachment()], errors: [{ message: "First attempt timed out" }] });
  reporter.onTestEnd(current, { status: "passed", retry: 1, attachments: [attachment(), metadataAttachment()], errors: [] });
  reporter.onEnd({ status: "passed", duration: 3 });
  const report = JSON.parse(readFileSync(path.join(directory, "latest.json"), "utf8"));
  assert.equal(report.tests[0].status, "flaky");
  assert.deepEqual(report.captures.map((capture) => capture.status), ["failed", "passed (retry 1)"]);
  assert.notEqual(report.captures[0].screenshot, report.captures[1].screenshot);
});

test("redaction removes JSON credentials, headers and bearer-shaped JWTs", () => {
  assert.equal(redact('password="private"'), "password=[redacted]");
  assert.equal(redact('{"api_key": "private"}'), "{api_key=[redacted]}");
  assert.equal(redact("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.fakeSignature"), "[redacted token]");
});
