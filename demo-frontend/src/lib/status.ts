import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CircleHelp,
  Copy,
  GitFork,
  GitMerge,
  Link2,
  PenLine,
  Plus,
  Scaling,
  SearchX,
  ToggleLeft,
  X,
  type LucideIcon,
} from "lucide-react";
import type { FunctionStatus, ReviewStatus, RiskKind, UnitStatus } from "@/types";

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  className: string;
  hint?: string;
}

const tone = {
  kept: "bg-status-kept-bg text-status-kept-fg border-status-kept-fg/20",
  reworded: "bg-status-reworded-bg text-status-reworded-fg border-status-reworded-fg/20",
  transferred: "bg-status-transferred-bg text-status-transferred-fg border-status-transferred-fg/20",
  split: "bg-status-split-bg text-status-split-fg border-status-split-fg/20",
  missing: "bg-status-missing-bg text-status-missing-fg border-status-missing-fg/20",
  duplicate: "bg-status-duplicate-bg text-status-duplicate-fg border-status-duplicate-fg/20",
  conflict: "bg-status-conflict-bg text-status-conflict-fg border-status-conflict-fg/20",
  new: "bg-status-new-bg text-status-new-fg border-status-new-fg/20",
};

export const FUNCTION_STATUS: Record<FunctionStatus, StatusMeta> = {
  kept: { label: "Сохранена", icon: Check, className: tone.kept },
  reworded: { label: "Переформулирована", icon: PenLine, className: tone.reworded },
  transferred: { label: "Передана", icon: ArrowRightLeft, className: tone.transferred },
  split: { label: "Разделена", icon: GitFork, className: tone.split },
  merged: { label: "Объединена", icon: GitMerge, className: tone.split },
  missing: {
    label: "Соответствие не найдено",
    icon: SearchX,
    className: tone.missing,
    hint: "Функция могла сменить исполнителя, номер или формулировку. Проверьте вручную по источнику.",
  },
  duplicate: { label: "Возможное дублирование", icon: Copy, className: tone.duplicate },
  conflict: {
    label: "Возможный конфликт",
    icon: AlertTriangle,
    className: tone.conflict,
    hint: "Конфликт интересов или противоречие требований — требует проверки ответственным сотрудником.",
  },
  new: { label: "Добавлено", icon: Plus, className: tone.new },
};

export const UNIT_STATUS: Record<UnitStatus, StatusMeta> = {
  kept: { label: "Сохранено", icon: Check, className: tone.kept },
  new: { label: "Добавлено", icon: Plus, className: tone.new },
  changed: { label: "Изменено", icon: PenLine, className: tone.reworded },
  missing: { label: "Не найдено в «После»", icon: SearchX, className: tone.missing },
};

export const RISK_KIND: Record<RiskKind, StatusMeta> = {
  duplicate: FUNCTION_STATUS.duplicate,
  conflict: FUNCTION_STATUS.conflict,
  reference: { label: "Возможно устаревшая ссылка", icon: Link2, className: tone.missing },
  modality: { label: "Изменена обязательность", icon: ToggleLeft, className: tone.reworded },
  scope: { label: "Изменена область действия", icon: Scaling, className: tone.reworded },
  unclear: { label: "Неясность", icon: CircleHelp, className: tone.missing },
};

/** Human review (product.md §3.5). Separate from the AI status: it never changes the finding itself. */
export const REVIEW_STATUS: Record<ReviewStatus, StatusMeta> = {
  unreviewed: { label: "Не проверено", icon: CircleHelp, className: "border-border bg-card text-muted-foreground" },
  confirmed: { label: "Подтверждено", icon: Check, className: tone.new },
  needs_clarification: { label: "Нужно уточнение", icon: CircleHelp, className: tone.missing },
  rejected: { label: "Отклонено", icon: X, className: "border-border bg-muted text-muted-foreground" },
};

/** Default order in the function table: what a human must check first goes on top. */
export const FUNCTION_SORT: FunctionStatus[] = [
  "missing",
  "transferred",
  "split",
  "merged",
  "reworded",
  "duplicate",
  "conflict",
  "kept",
  "new",
];

export function metaFor(kind: "function" | "unit" | "risk", status: string): StatusMeta | undefined {
  if (kind === "unit") return UNIT_STATUS[status as UnitStatus];
  if (kind === "risk") return RISK_KIND[status as RiskKind];
  return FUNCTION_STATUS[status as FunctionStatus];
}
