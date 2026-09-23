import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const defaultReportDir = fileURLToPath(new URL("../../docs/report/", import.meta.url));

export function redact(value) {
  let text = stripVTControlCharacters(String(value ?? ""));
  for (const [key, secret] of Object.entries(process.env)) {
    if (/password|secret|token|api.?key|database_url/i.test(key) && secret?.length >= 4) {
      text = text.replaceAll(secret, "[redacted]");
    }
  }
  return text
    .replace(/\b(authorization|cookie|set-cookie)\s*:[^\r\n]*/gi, "$1: [redacted]")
    .replace(/["']?\b(password|secret|access_token|refresh_token|session_token|api_key)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[redacted]")
    .replace(/(https?|postgres(?:ql)?):\/\/[^\s/@]+:[^\s/@]+@/gi, "$1://[redacted]@")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]");
}

function cell(value) {
  return redact(value).replaceAll("|", "\\|").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/[\r\n]+/g, " ");
}

function safeSlug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "page";
}

function safeRoute(value) {
  if (!value) return "Unavailable";
  try {
    const route = new URL(value, "http://local.test");
    const allowed = new Set(["analysis", "finding", "tab", "change", "issue", "review", "unit"]);
    for (const key of [...route.searchParams.keys()]) {
      if (!allowed.has(key)) route.searchParams.delete(key);
    }
    return redact(`${route.pathname}${route.search}`);
  } catch {
    return "Unavailable";
  }
}

function viewportLabel(viewport) {
  return Number.isFinite(viewport?.width) && Number.isFinite(viewport?.height)
    ? `${viewport.width} × ${viewport.height}`
    : "Browser default";
}

function writeAtomic(file, contents) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, contents, "utf8");
  renameSync(temporary, file);
}

export function renderMarkdown(report) {
  const totals = { passed: 0, failed: 0, flaky: 0, skipped: 0, "not run": 0 };
  for (const test of report.tests) totals[test.status] += 1;
  const lines = [
    "# Latest Delphi UI report",
    "",
    `Generated: ${report.generatedAt}  `,
    `Run: ${report.runId}  `,
    `Result: **${report.status}** · Duration: ${(report.durationMs / 1000).toFixed(1)} seconds`,
    "",
    "Browser checks cover the local application. Each capture identifies its data source: live local backend data or explicitly mocked synthetic results. Synthetic results test UI interactions; they do not validate live AI analysis or translation quality. Authentication uses the local application. This report contains screenshots only, not session cookies, authentication state or traces.",
    "",
    "## Test results",
    "",
    "| Total | Passed | Failed | Flaky | Skipped | Not run |",
    "|---|---|---|---|---|---|",
    `| ${report.tests.length} | ${totals.passed} | ${totals.failed} | ${totals.flaky} | ${totals.skipped} | ${totals["not run"]} |`,
    "",
    "## Pages and states",
    "",
    "Each row is a captured state from this run. A screenshot can exist even when a later assertion in its test fails; the status records the test attempt that produced it.",
    "",
    "| Page | Short description | Route | Viewport | Data source | Test status | Screenshot |",
    "|---|---|---|---|---|---|---|",
  ];

  for (const capture of report.captures) {
    const link = capture.screenshot ? `[Open screenshot](${capture.screenshot})` : `Unavailable: ${cell(capture.artifactError)}`;
    lines.push(`| ${cell(capture.name)} | ${cell(capture.description)} | ${cell(capture.route)} | ${cell(capture.viewport)} | ${cell(capture.dataSource)} | ${cell(capture.status)} | ${link} |`);
  }
  if (!report.captures.length) lines.push("| No screenshots captured in this run | — | — | — | — | — | — |");

  lines.push("", "## Checks", "", "| Test | Project | Result |", "|---|---|---|");
  for (const test of report.tests) lines.push(`| ${cell(test.title)} | ${cell(test.project)} | ${cell(test.status)} |`);

  const failures = [
    ...report.errors.map((message) => ({ title: "Run error", message })),
    ...report.tests.flatMap((test) => test.errors.map((message) => ({ title: test.title, message }))),
  ];
  if (failures.length) {
    lines.push("", "## Failure details", "");
    for (const failure of failures) {
      lines.push(`### ${cell(failure.title)}`, "");
      for (const line of redact(failure.message).slice(0, 4000).split("\n")) lines.push(`> ${cell(line)}`);
      lines.push("");
    }
  }

  if (report.captures.some((capture) => capture.screenshot)) lines.push("", "## Screenshot previews", "");
  for (const capture of report.captures) {
    if (!capture.screenshot) continue;
    lines.push(
      `### ${cell(capture.name)} · ${cell(capture.viewport)}`,
      "",
      `${cell(capture.description)} **Data:** ${cell(capture.dataSource)}. **Test:** ${cell(capture.status)}.`,
      "",
      `![${cell(capture.name).replaceAll("[", "\\[").replaceAll("]", "\\]")}](${capture.screenshot})`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Pair `page:<slug>` PNGs with `page-meta:<slug>` JSON attachments. */
export default class UiReport {
  constructor(options = {}) {
    this.reportDir = path.resolve(options.outputDir ?? defaultReportDir);
    this.runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    this.startedAt = Date.now();
    this.tests = new Map();
    this.captures = [];
    this.errors = [];
    this.artifactNumber = 0;
  }

  onBegin(_config, suite) {
    this.startedAt = Date.now();
    for (const test of suite.allTests()) this.tests.set(test.id, { test, results: [] });
    mkdirSync(path.join(this.reportDir, "screenshots", this.runId), { recursive: true });
    this.writeReport("running", 0);
  }

  onTestEnd(test, result) {
    const entry = this.tests.get(test.id) ?? { test, results: [] };
    entry.results.push(result);
    this.tests.set(test.id, entry);
    const project = test.parent.project();
    let previousDataSource;
    const metadataAttachments = new Map(result.attachments
      .filter((attachment) => attachment.name.startsWith("page-meta:") && attachment.contentType === "application/json")
      .map((attachment) => [attachment.name.slice(10), attachment]));

    for (const attachment of result.attachments) {
      if (attachment.contentType !== "image/png") continue;
      let metadata = {};
      let metadataError;
      if (attachment.name.startsWith("page:")) {
        try {
          const slug = attachment.name.slice(5);
          const companion = metadataAttachments.get(slug);
          if (!companion) throw new Error("Missing page metadata attachment");
          const contents = companion.body ?? (companion.path ? readFileSync(companion.path) : undefined);
          const value = JSON.parse(contents?.toString() ?? "");
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected page metadata object");
          for (const key of ["slug", "name", "description", "route", "dataSource"]) {
            if (typeof value[key] !== "string" || !value[key].trim()) throw new Error(`Missing page metadata: ${key}`);
          }
          if (value.slug !== slug) throw new Error("Page metadata does not match screenshot");
          metadata = value;
          previousDataSource = metadata.dataSource;
        } catch {
          metadataError = "Invalid page attachment metadata; inspect the test helper.";
        }
      }
      const automatic = !attachment.name.startsWith("page:");
      const capture = {
        name: metadata.name ?? `${test.title} — ${automatic ? "automatic screenshot" : "unnamed page"}`,
        description: metadata.description ?? metadataError ?? "Playwright captured the page when the test failed.",
        route: safeRoute(metadata.route),
        viewport: viewportLabel(metadata.viewport ?? project?.use?.viewport),
        dataSource: metadata.dataSource ?? previousDataSource ?? (automatic ? "Unspecified; automatic failure capture" : "Unspecified; missing page metadata"),
        status: `${result.status}${result.retry ? ` (retry ${result.retry})` : ""}`,
        test: test.titlePath().filter(Boolean).join(" › "),
        project: project?.name ?? "default",
      };
      const file = `${String(++this.artifactNumber).padStart(3, "0")}-${safeSlug(metadata.slug ?? test.title)}-${safeSlug(capture.project)}.png`;
      const relative = `screenshots/${this.runId}/${file}`;
      try {
        const target = path.join(this.reportDir, relative);
        if (attachment.path) copyFileSync(attachment.path, target);
        else if (attachment.body) writeFileSync(target, attachment.body);
        else throw new Error("Screenshot attachment has no file or body");
        capture.screenshot = relative;
      } catch {
        capture.artifactError = "Screenshot artifact could not be copied.";
        this.errors.push(`${capture.name}: screenshot artifact could not be copied.`);
      }
      if (metadataError) this.errors.push(metadataError);
      this.captures.push(capture);
    }
  }

  onError(error) {
    this.errors.push(redact(error.message ?? "Unspecified Playwright error"));
  }

  onEnd(result) {
    const status = this.errors.length && result.status === "passed" ? "failed" : result.status;
    try {
      this.writeReport(status, result.duration ?? Date.now() - this.startedAt);
    } catch (error) {
      console.error(`UI report could not be written: ${redact(error.message)}`);
      return { status: "failed" };
    }
    if (status !== result.status) return { status };
  }

  writeReport(status, durationMs) {
    mkdirSync(this.reportDir, { recursive: true });
    const tests = [...this.tests.values()].map(({ test, results }) => {
      const last = results.at(-1);
      const outcome = results.length ? test.outcome() : undefined;
      return {
        title: redact(test.titlePath().filter(Boolean).join(" › ")),
        project: test.parent.project()?.name ?? "default",
        status: !last ? "not run" : outcome === "flaky" ? "flaky" : last.status === "skipped" ? "skipped" : outcome === "expected" ? "passed" : "failed",
        errors: results.flatMap((result) => result.errors ?? []).map((error) => redact(error.message ?? "Unspecified test error").slice(0, 4000)),
      };
    });
    const report = {
      generatedAt: new Date().toISOString(),
      runId: this.runId,
      status,
      durationMs,
      tests,
      captures: this.captures.map((capture) => Object.fromEntries(Object.entries(capture).map(([key, value]) => [key, typeof value === "string" ? redact(value) : value]))),
      errors: this.errors.map(redact),
    };
    writeAtomic(path.join(this.reportDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeAtomic(path.join(this.reportDir, "latest.md"), renderMarkdown(report));
  }
}
