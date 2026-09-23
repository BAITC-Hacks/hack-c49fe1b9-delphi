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
    xlsx_schema_unrecognized: t("Проверьте структуру столбцов таблицы", "Кесте бағандарының құрылымын тексеріңіз", "Review the spreadsheet column structure"),
    toc_boundary_requires_review: t("Текст у границы оглавления сохранён и требует проверки", "Мазмұн шекарасындағы мәтін сақталды, оны тексеру қажет", "Text at an uncertain contents boundary was preserved for review"),
    pdf_reading_order_requires_review: t("Проверьте порядок чтения колонок и таблиц PDF", "PDF бағандары мен кестелерін оқу ретін тексеріңіз", "Review the reading order of PDF columns and tables"),
    pdf_page_extraction_failed: t("Не удалось прочитать страницу PDF", "PDF бетін оқу мүмкін болмады", "A PDF page could not be read"),
    markdown_images_not_extracted: t("Изображения Markdown не прочитаны", "Markdown суреттері оқылмады", "Markdown images were not read"),
    nested_tables_not_extracted: t("Вложенная таблица не прочитана", "Кірістірілген кесте оқылмады", "A nested table was not read"),
    docx_body_element_not_extracted: t("Часть документа Word не прочитана", "Word құжатының бір бөлігі оқылмады", "Part of the Word document was not read"),
    docx_textboxes_not_extracted: t("Текстовые поля Word не прочитаны", "Word мәтіндік өрістері оқылмады", "Word text boxes were not read"),
    docx_drawings_not_extracted: t("Рисунки Word не прочитаны", "Word суреттері оқылмады", "Word drawings were not read"),
    docx_embedded_objects_not_extracted: t("Вложения Word не прочитаны", "Word тіркемелері оқылмады", "Embedded Word objects were not read"),
    docx_footnotes_not_extracted: t("Сноски Word не прочитаны", "Word сілтемелері оқылмады", "Word footnotes were not read"),
    docx_endnotes_not_extracted: t("Концевые сноски Word не прочитаны", "Word соңғы сілтемелері оқылмады", "Word endnotes were not read"),
    docx_headers_footers_not_extracted: t("Колонтитулы Word не прочитаны", "Word колонтитулдары оқылмады", "Word headers and footers were not read"),
  };
  return labels[code] ? `${labels[code]}${details.length ? `: ${details.join(":")}` : ""}` : warning;
}
