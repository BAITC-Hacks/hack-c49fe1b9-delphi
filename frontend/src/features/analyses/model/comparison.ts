import { z } from "zod";

export const comparisonSchema = z.object({ title: z.string().trim().min(1).max(200) });
export const revisionSchema = z.object({ revision: z.string().trim().max(100) });
export type ComparisonValues = z.infer<typeof comparisonSchema>;
export type RevisionValues = z.infer<typeof revisionSchema>;

export const supportedDocumentTypes = ".docx,.pdf,.xlsx,.md";

export function warningDescription(warning: string, t: (ru: string, kk: string, en: string) => string) {
  const [code, ...details] = warning.split(":");
  const labels: Record<string, string> = {
    table_of_contents_skipped: t("Оглавление пропущено", "Мазмұн өткізіліп жіберілді", "Table of contents skipped"),
    missing_annex: t("Текст приложения отсутствует", "Қосымша мәтіні жоқ", "Referenced annex text is missing"),
    missing_annex_content: t("Текст приложения отсутствует", "Қосымша мәтіні жоқ", "Referenced annex text is missing"),
    referenced_annex_not_found: t("Указанное приложение отсутствует", "Көрсетілген қосымша жоқ", "Referenced annex is missing"),
    empty_clause: t("Пустой пункт", "Бос тармақ", "Empty clause"),
    pdf_page_without_text: t("Страница PDF без доступного текста", "PDF бетінде оқылатын мәтін жоқ", "PDF page has no extractable text"),
    docx_tracked_changes_not_resolved: t("Исправления Word не согласованы", "Word түзетулері шешілмеген", "Tracked changes have not been resolved"),
    automatic_numbering_not_resolved: t("Автоматическая нумерация не восстановлена", "Автоматты нөмірлеу қалпына келтірілмеді", "Automatic numbering could not be resolved"),
    xlsx_formulas_not_evaluated: t("Формулы Excel не вычислены", "Excel формулалары есептелмеді", "Spreadsheet formulas have not been evaluated"),
  };
  return labels[code] ? `${labels[code]}${details.length ? `: ${details.join(":")}` : ""}` : warning;
}
