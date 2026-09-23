import type { ClauseRef } from "@/types";

/** Citation format agreed for the whole product: "ред. 9, п. 5.3.3". */
export function citeRef(ref: ClauseRef): string {
  return `${ref.edition}, п. ${ref.clause_number}`;
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)} %`;
}

export function confidenceHint(value: number): string {
  if (value >= 0.85) return "Высокая уверенность: совпадают формулировка и состав исполнителей.";
  if (value >= 0.6) return "Средняя уверенность: совпадает смысл, формулировка или исполнитель изменились.";
  return "Низкая уверенность: аналог не найден или найден частично. Проверьте вручную.";
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${Math.round(ms)} мс`;
}

const COUNTER_LABELS: Record<string, string> = {
  clauses: "пунктов извлечено",
  units: "подразделений найдено",
  functions: "функций выделено",
  matched: "сопоставлено",
  total: "всего",
  risks: "рисков к проверке",
  references: "ссылок проверено",
};

export function counterLabel(key: string): string {
  return COUNTER_LABELS[key] ?? key;
}
