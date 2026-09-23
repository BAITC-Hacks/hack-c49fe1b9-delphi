import type { AnalysisResult } from "@/types";
import { citeRef } from "@/lib/format";
import { FUNCTION_STATUS, RISK_KIND, UNIT_STATUS } from "@/lib/status";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Self-contained HTML report: opens anywhere, prints to PDF, keeps every citation. */
export function buildHtml(r: AnalysisResult): string {
  const units = r.units
    .map(
      (u) =>
        `<tr><td>${esc(u.name)}</td><td>${esc(UNIT_STATUS[u.status].label)}</td><td>${
          u.before ? esc(citeRef(u.before)) : "—"
        }</td><td>${u.after ? esc(citeRef(u.after)) : "—"}</td></tr>`,
    )
    .join("");

  const functions = r.functions
    .map((f) => {
      const after = (f.after ?? []).map((a) => `${esc(a.unit)} — ${esc(citeRef(a.ref))}`).join("<br/>") || "—";
      return `<tr><td>${esc(f.title)}</td><td>${f.before ? `${esc(f.before.unit)} — ${esc(citeRef(f.before.ref))}` : "—"}</td><td>${after}</td><td>${esc(
        FUNCTION_STATUS[f.status].label,
      )}</td><td>${f.confidence != null ? `${Math.round(f.confidence * 100)} %` : "—"}</td><td>${esc(f.note ?? "")}</td></tr>`;
    })
    .join("");

  const risks = r.risks
    .map(
      (k) =>
        `<li><strong>${esc(RISK_KIND[k.kind].label)}: ${esc(k.title)}</strong><br/>${esc(k.a.unit)} — ${esc(
          citeRef(k.a.ref),
        )} · ${esc(k.b.unit)} — ${esc(citeRef(k.b.ref))}<br/><em>Почему:</em> ${esc(k.why)}<br/><em>Что проверить:</em> ${esc(k.check)}</li>`,
    )
    .join("");

  const sections = r.conclusion.sections
    .map(
      (s) =>
        `<h3>${esc(s.title)}</h3><ul>${s.items
          .map((i) => `<li>${esc(i.text)} <small>(${i.refs.map(citeRef).map(esc).join("; ")})</small></li>`)
          .join("")}</ul>`,
    )
    .join("");

  const limitations = r.conclusion.limitations.map((l) => `<li>${esc(l)}</li>`).join("");

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Delphi — заключение</title>
<style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:960px;margin:32px auto;padding:0 16px}
h1{font-size:22px}h2{font-size:18px;margin-top:28px}h3{font-size:15px;margin-top:18px}table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border:1px solid #cbd5e1;padding:6px 8px;vertical-align:top;text-align:left}th{background:#f1f5f9}small{color:#475569}li{margin:6px 0}</style></head><body>
<h1>Delphi — контроль функций при реорганизации</h1>
<p>Комплект «До»: ${esc(r.editions.before.label)}${r.editions.before.date ? ` (${esc(r.editions.before.date)})` : ""}.
Комплект «После»: ${esc(r.editions.after.label)}${r.editions.after.date ? ` (${esc(r.editions.after.date)})` : ""}.
Режим: ${esc(r.mode)}. Выводы носят рекомендательный характер и требуют проверки ответственным сотрудником.</p>
<h2>Структура</h2><table><tr><th>Подразделение</th><th>Статус</th><th>Источник «До»</th><th>Источник «После»</th></tr>${units}</table>
<h2>Функции</h2><table><tr><th>Функция</th><th>«До»</th><th>«После»</th><th>Статус</th><th>Уверенность</th><th>Комментарий</th></tr>${functions}</table>
<h2>Вопросы для проверки</h2><ul>${risks || "<li>Не выявлено.</li>"}</ul>
<h2>Заключение</h2>${sections}
<h3>Ограничения анализа</h3><ul>${limitations}</ul>
</body></html>`;
}

export function buildCsv(r: AnalysisResult): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = [
    "status",
    "title",
    "before_unit",
    "before_clause",
    "after_unit",
    "after_clause",
    "confidence",
    "note",
  ];
  const rows = r.functions.map((f) =>
    [
      f.status,
      f.title,
      f.before?.unit ?? "",
      f.before ? citeRef(f.before.ref) : "",
      (f.after ?? []).map((a) => a.unit).join(" | "),
      (f.after ?? []).map((a) => citeRef(a.ref)).join(" | "),
      f.confidence != null ? String(Math.round(f.confidence * 100)) : "",
      f.note ?? "",
    ]
      .map(q)
      .join(","),
  );
  return "﻿" + [header.join(","), ...rows].join("\r\n");
}
