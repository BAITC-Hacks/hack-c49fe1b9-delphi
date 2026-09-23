import { Link } from "react-router-dom";
import { ArrowRightLeft, ListChecks, SearchX, TriangleAlert, type LucideIcon } from "lucide-react";
import { buildQueue } from "@/hooks/useReviewQueue";
import { cn } from "@/lib/utils";
import type { AnalysisResult } from "@/types";

interface Tile {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: string;
  /** Query for the review queue: which items this counter opens. */
  query: string;
}

/** Clickable counters: each number opens the review queue filtered to exactly those findings. */
export function SummaryTiles({ result, analysisId }: { result: AnalysisResult; analysisId: string }) {
  const items = buildQueue(result);
  const count = (statuses: string[]) => items.filter((i) => statuses.includes(i.status)).length;
  const riskKinds = [...new Set(result.risks.map((r) => r.kind))];
  const moved = ["transferred", "split", "merged"];
  const tiles: Tile[] = [
    {
      label: "Соответствие не найдено",
      value: count(["missing"]),
      icon: SearchX,
      tone: "border-l-status-missing-fg text-status-missing-fg",
      query: "status=missing&review=all",
    },
    {
      label: "Передано, разделено, объединено",
      value: count(moved),
      icon: ArrowRightLeft,
      tone: "border-l-status-transferred-fg text-status-transferred-fg",
      query: `status=${moved.join(",")}&review=all`,
    },
    {
      label: "Пересечения и другие вопросы",
      value: count(riskKinds),
      icon: TriangleAlert,
      tone: "border-l-status-conflict-fg text-status-conflict-fg",
      query: `status=${riskKinds.join(",")}&review=all`,
    },
    {
      label: "Ждут решения человека",
      value: items.filter((i) => i.question && i.review.status === "unreviewed").length,
      icon: ListChecks,
      tone: "border-l-primary text-primary",
      query: "",
    },
  ];
  return (
    <ul className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Сводка">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <li key={t.label}>
            <Link
              to={`/analyses/${encodeURIComponent(analysisId)}/review${t.query ? `?${t.query}` : ""}`}
              className={cn(
                "flex h-full flex-col gap-1 rounded-lg border border-l-4 bg-card px-3 py-2.5 outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                t.tone,
                t.value === 0 && "opacity-60",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <Icon className="size-3.5" aria-hidden="true" />
                {t.label}
              </span>
              <span className="text-2xl font-semibold tabular-nums text-foreground">{t.value}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
