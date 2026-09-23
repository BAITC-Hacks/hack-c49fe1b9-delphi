import type { SourceResponse } from "@/shared/api/generated";

export function sourceLocation(
  locator: SourceResponse["locator"],
  t: (ru: string, kk: string, en: string) => string,
) {
  const fields = [
    ["sheet", t("Лист", "Парақ", "Sheet")],
    ["page", t("Страница", "Бет", "Page")],
    ["table", t("Таблица", "Кесте", "Table")],
    ["row", t("Строка", "Жол", "Row")],
    ["column", t("Столбец", "Баған", "Column")],
    ["range", t("Ячейки", "Ұяшықтар", "Cells")],
    ["paragraph", t("Абзац", "Абзац", "Paragraph")],
    ["line", t("Строка текста", "Мәтін жолы", "Text line")],
  ];
  const parts = fields.flatMap(([key, label]) => {
    const value = locator[key];
    return typeof value === "string" || typeof value === "number"
      ? [`${label}: ${value}`]
      : [];
  });
  return parts.join(" · ") || t(
    "Точное положение не указано",
    "Нақты орны көрсетілмеген",
    "Exact position is unavailable",
  );
}
