import type {
  FindingResponse,
  ReviewResponse,
  RunDetail,
  StructureChange,
} from "@/shared/api/generated";

export type Translate = (ru: string, kk: string, en: string) => string;

const changes: Record<
  FindingResponse["change_type"],
  [string, string, string]
> = {
  retained: ["Сохранена", "Сақталды", "Retained"],
  reworded: ["Переформулирована", "Қайта тұжырымдалды", "Reworded"],
  transferred: ["Передана", "Берілді", "Transferred"],
  split: ["Разделена", "Бөлінді", "Split"],
  merged: ["Объединена", "Біріктірілді", "Merged"],
  new: ["Новая", "Жаңа", "New"],
  potentially_missing: [
    "Соответствие не найдено",
    "Сәйкестік табылмады",
    "No match found",
  ],
  changed: ["Изменена", "Өзгерді", "Changed"],
  structure_changed: [
    "Изменение структуры",
    "Құрылым өзгерді",
    "Structure changed",
  ],
};
const issues: Record<
  NonNullable<FindingResponse["issue_type"]>,
  [string, string, string]
> = {
  overlap: ["Пересечение", "Қабаттасу", "Overlap"],
  potential_conflict: [
    "Возможное противоречие",
    "Ықтимал қайшылық",
    "Potential conflict",
  ],
  modality_changed: [
    "Изменение обязательности",
    "Міндеттілік өзгерді",
    "Obligation changed",
  ],
  scope_changed: [
    "Изменение области действия",
    "Қолданылу аясы өзгерді",
    "Scope changed",
  ],
  insufficient_evidence: [
    "Недостаточно доказательств",
    "Дәлел жеткіліксіз",
    "Insufficient evidence",
  ],
};
const reviews: Record<ReviewResponse["status"], [string, string, string]> = {
  unreviewed: ["Не проверен", "Тексерілмеген", "Unreviewed"],
  confirmed: ["Подтверждён", "Расталды", "Confirmed"],
  needs_clarification: ["Есть вопрос", "Нақтылау қажет", "Needs clarification"],
  rejected: ["Отклонён", "Қабылданбады", "Rejected"],
};
const structures: Record<StructureChange["status"], [string, string, string]> =
  {
    retained: ["Сохранено", "Сақталды", "Retained"],
    newly_listed: [
      "Впервые указано в редакции",
      "Осы редакцияда алғаш көрсетілген",
      "Newly listed in this version",
    ],
    transformed: ["Преобразовано", "Қайта құрылды", "Transformed"],
    unmatched: [
      "Связь не установлена",
      "Байланыс анықталмады",
      "No mapping established",
    ],
  };
const stages: Record<RunDetail["stage"], [string, string, string]> = {
  queued: ["Ожидает запуска", "Іске қосылуды күтуде", "Queued"],
  extracting: [
    "Чтение структуры и функций",
    "Құрылым мен функцияларды оқу",
    "Extracting structure and functions",
  ],
  comparing: [
    "Сопоставление функций",
    "Функцияларды салыстыру",
    "Matching functions",
  ],
  checking_risks: [
    "Проверка вопросов и пробелов",
    "Сұрақтар мен олқылықтарды тексеру",
    "Checking risks and gaps",
  ],
  validating: [
    "Проверка источников",
    "Дереккөздерді тексеру",
    "Validating evidence",
  ],
  completed: ["Завершён", "Аяқталды", "Completed"],
  partial: ["Есть ограничения", "Шектеулер бар", "Has limitations"],
  failed: ["Ошибка анализа", "Талдау қатесі", "Analysis failed"],
  interrupted: ["Прерван", "Үзілді", "Interrupted"],
};

export const changeLabel = (
  value: FindingResponse["change_type"],
  t: Translate,
) => t(...changes[value]);
export const issueLabel = (
  value: NonNullable<FindingResponse["issue_type"]>,
  t: Translate,
) => t(...issues[value]);
export const reviewLabel = (value: ReviewResponse["status"], t: Translate) =>
  t(...reviews[value]);
export const structureLabel = (
  value: StructureChange["status"],
  t: Translate,
) => t(...structures[value]);
export const stageLabel = (value: RunDetail["stage"], t: Translate) =>
  t(...stages[value]);
export const changeTypes = Object.keys(
  changes,
) as FindingResponse["change_type"][];
export const issueTypes = Object.keys(issues) as NonNullable<
  FindingResponse["issue_type"]
>[];
export const reviewStatuses = Object.keys(
  reviews,
) as ReviewResponse["status"][];
export const hasIssue = (finding: FindingResponse) =>
  finding.issue_type !== null || finding.change_type === "potentially_missing";
export const runIsActive = (state: RunDetail["state"]) =>
  state === "queued" || state === "running";
