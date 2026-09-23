"use client";

import {
  ArrowRightLeft, Check, CircleHelp, Copy, GitFork, GitMerge,
  ListChecks, PenLine, Plus, SearchX, TriangleAlert, X, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { changeLabel, issueLabel, reviewLabel, structureLabel } from "@/features/results/model/labels";
import type { FindingResponse, ReviewResponse, StructureChange } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/lib/utils";

const tones = {
  kept: "border-status-kept-fg/20 bg-status-kept-bg text-status-kept-fg",
  reworded: "border-status-reworded-fg/20 bg-status-reworded-bg text-status-reworded-fg",
  transferred: "border-status-transferred-fg/20 bg-status-transferred-bg text-status-transferred-fg",
  split: "border-status-split-fg/20 bg-status-split-bg text-status-split-fg",
  missing: "border-status-missing-fg/20 bg-status-missing-bg text-status-missing-fg",
  duplicate: "border-status-duplicate-fg/20 bg-status-duplicate-bg text-status-duplicate-fg",
  conflict: "border-status-conflict-fg/20 bg-status-conflict-bg text-status-conflict-fg",
  new: "border-status-new-fg/20 bg-status-new-bg text-status-new-fg",
};

export function FindingStatusBadge({ changeType, issueType, reviewStatus, structureStatus, className }: {
  changeType?: FindingResponse["change_type"];
  issueType?: FindingResponse["issue_type"];
  reviewStatus?: ReviewResponse["status"];
  structureStatus?: StructureChange["status"];
  className?: string;
}) {
  const { t } = useI18n();
  let label = "";
  let tone: keyof typeof tones = "kept";
  let Icon: LucideIcon = Check;
  if (reviewStatus) {
    label = reviewLabel(reviewStatus, t);
    if (reviewStatus === "unreviewed") Icon = ListChecks;
    if (reviewStatus === "confirmed") tone = "new";
    if (reviewStatus === "needs_clarification") { Icon = CircleHelp; tone = "missing"; }
    if (reviewStatus === "rejected") Icon = X;
  } else if (structureStatus) {
    label = structureLabel(structureStatus, t);
    if (structureStatus === "newly_listed") { Icon = Plus; tone = "new"; }
    if (structureStatus === "transformed") { Icon = PenLine; tone = "reworded"; }
    if (structureStatus === "unmatched") { Icon = SearchX; tone = "missing"; }
  } else if (issueType) {
    label = issueLabel(issueType, t);
    if (issueType === "overlap") { Icon = Copy; tone = "duplicate"; }
    else if (issueType === "potential_conflict") { Icon = TriangleAlert; tone = "conflict"; }
    else if (issueType === "insufficient_evidence") { Icon = CircleHelp; tone = "missing"; }
    else { Icon = PenLine; tone = "reworded"; }
  } else if (changeType) {
    label = changeLabel(changeType, t);
    if (changeType === "transferred") { Icon = ArrowRightLeft; tone = "transferred"; }
    if (changeType === "split") { Icon = GitFork; tone = "split"; }
    if (changeType === "merged") { Icon = GitMerge; tone = "split"; }
    if (changeType === "new") { Icon = Plus; tone = "new"; }
    if (changeType === "potentially_missing") { Icon = SearchX; tone = "missing"; }
    if (["reworded", "changed", "structure_changed"].includes(changeType)) { Icon = PenLine; tone = "reworded"; }
  } else return null;
  return <Badge variant="outline" className={cn("max-w-full gap-1 whitespace-normal text-left font-medium", tones[tone], className)}>
    <Icon className="size-3 shrink-0" aria-hidden="true" />{label}
  </Badge>;
}
