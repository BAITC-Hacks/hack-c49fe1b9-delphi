import type { AnalysisResult, ClauseRef, FunctionSide, Review } from "@/types";
import { citeRef } from "@/lib/format";
import { FUNCTION_STATUS, REVIEW_STATUS, UNIT_STATUS } from "@/lib/status";
import { reviewQueue, riskSummary, uniqueRefs } from "@/lib/evidence";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const reviewLabel = (r?: Review) => REVIEW_STATUS[r?.status ?? "unreviewed"].label;
const refsText = (refs: ClauseRef[]) => refs.map(citeRef).join("; ");
const sidesText = (sides: FunctionSide[]) => sides.map((s) => `${s.unit} — ${refsText(s.refs)}`).join(" | ");

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** All decisions use the same finding IDs and saved review as the on-screen queue. */
export function buildHtml(r: AnalysisResult): string {
  const units = r.units.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(UNIT_STATUS[u.status].label)}</td><td>${esc(refsText(u.before))}</td><td>${esc(refsText(u.after))}</td></tr>`).join("");
  const functions = r.functions.map((f) => `<tr><td>${esc(f.title)}</td><td>${esc(sidesText(f.before))}</td><td>${esc(sidesText(f.after))}</td><td>${esc(FUNCTION_STATUS[f.status].label)}</td><td>${esc(reviewLabel(f.review))}<br/>${esc(f.review?.note ?? "")}</td></tr>`).join("");
  const queue = reviewQueue(r);
  const decisions = (["unreviewed", "needs_clarification", "confirmed", "rejected"] as const).map((status) => {
    const entries = queue.filter((f) => (f.review?.status ?? "unreviewed") === status);
    if (!entries.length) return "";
    return `<h3>${esc(REVIEW_STATUS[status].label)}</h3><ul>${entries.map((f) => `<li><strong>${esc(f.title)}</strong><p>${esc(f.note ?? "")}</p><p>${esc(f.recommendation ?? "")}</p>${f.review?.note ? `<p>Заметка проверяющего: ${esc(f.review.note)}</p>` : ""}<small>${esc(refsText(uniqueRefs([...(f.before ?? []), ...(f.after ?? []), ...(f.context ?? [])])))}</small>${f.error ? `<p>Доказательства загружены не полностью: ${esc(f.error)}</p>` : ""}</li>`).join("")}</ul>`;
  }).join("");
  const sections = r.conclusion.sections.map((s) => `<h3>${esc(s.title)}</h3><ul>${s.items.map((i) => `<li>${esc(i.text)} <small>${esc(refsText(i.refs))}</small></li>`).join("")}</ul>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Delphi — заключение</title><style>
  body{font:14px/1.6 system-ui,sans-serif;color:#1a2335;max-width:1100px;margin:32px auto;padding:0 20px}h1{font-size:24px}h2{font-size:20px;margin-top:32px}h3{font-size:16px}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #dde2eb;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef1f6}small{color:#5d6a80}li{margin:12px 0}p{white-space:pre-line}@media print{body{margin:0}tr,li{break-inside:avoid}}
  </style></head><body><h1>Delphi — заключение по сравнению документов</h1>
  <p>До: ${esc(r.editions.before.label)}. После: ${esc(r.editions.after.label)}.</p><p>${esc(riskSummary(r))}</p>
  <h2>Решения по выводам</h2>${decisions || "<p>Выводы для проверки отсутствуют.</p>"}
  <h2>Структура</h2><table><tr><th>Подразделение</th><th>Статус</th><th>До</th><th>После</th></tr>${units}</table>
  <h2>Функции</h2><table><tr><th>Функция</th><th>До</th><th>После</th><th>Изменение</th><th>Проверка человеком</th></tr>${functions}</table>
  <h2>Заключение</h2>${sections}<h2>Ограничения анализа</h2><ul>${r.conclusion.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></body></html>`;
}

export function buildCsv(r: AnalysisResult): string {
  // Spreadsheet applications must not interpret source or reviewer text as formulas.
  const q = (s: string) => `"${(/^[\s]*[=+@-]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
  const header = ["status", "title", "before_units", "before_sources", "after_units", "after_sources", "note", "review", "review_note"];
  const rows = r.functions.map((f) => [f.status, f.title, f.before.map((s) => s.unit).join(" | "), refsText(f.before.flatMap((s) => s.refs)), f.after.map((s) => s.unit).join(" | "), refsText(f.after.flatMap((s) => s.refs)), f.note ?? "", reviewLabel(f.review), f.review?.note ?? ""].map(q).join(","));
  return "\uFEFF" + [header.join(","), ...rows].join("\r\n");
}
