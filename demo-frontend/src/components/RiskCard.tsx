import { riskEvidence } from "@/lib/evidence";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RefButton } from "@/components/RefButton";
import { ReviewChip } from "@/components/ReviewControls";
import { StatusChip } from "@/components/StatusChip";
import { FUNCTION_STATUS } from "@/lib/status";
import type { EvidenceRequest, Risk } from "@/types";

interface Props {
  risk: Risk;
  onEvidence(req: EvidenceRequest): void;
}

export function RiskCard({ risk, onEvidence }: Props) {
  const open = () => onEvidence(riskEvidence(risk));

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-1 duration-150">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={risk.kind} kind="risk" />
          <h3 className="text-base font-semibold">{risk.title}</h3>
          <ReviewChip review={risk.review} className="ml-auto" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          {risk.sides.map((side, i) => (
            <div key={i} className="rounded-md border bg-muted/40 p-3">
              <p className="text-sm font-medium">{side.unit}</p>
              {side.summary && <p className="mt-0.5 text-sm text-muted-foreground">{side.summary}</p>}
              <div className="mt-2">
                {side.refs.map((ref, j) => <RefButton key={j} ref_={ref} onClick={open} />)}
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Почему это может быть проблемой</p>
            <p className="mt-1 text-sm">{risk.why}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Что проверить</p>
            <p className="mt-1 text-sm">{risk.check}</p>
          </div>
        </div>
        {risk.kind === "conflict" && (
          <p className="rounded-md border border-status-conflict-fg/20 bg-status-conflict-bg px-3 py-2 text-sm text-status-conflict-fg">
            {FUNCTION_STATUS.conflict.hint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
