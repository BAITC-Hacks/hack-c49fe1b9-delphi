import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RefButton } from "@/components/RefButton";
import type { AnalysisResult, ClauseRef, EvidenceRequest } from "@/types";

interface Props {
  result: AnalysisResult;
  onEvidence(req: EvidenceRequest): void;
}

export function ConclusionReport({ result, onEvidence }: Props) {
  const sideOf = (ref: ClauseRef) =>
    ref.side ??
    (ref.document_id === result.units.find((u) => u.before)?.before?.document_id
      ? "before"
      : ref.document_id === result.units.find((u) => u.after)?.after?.document_id
        ? "after"
        : undefined);
  const openRef = (text: string, ref: ClauseRef) =>
    onEvidence({
      title: text,
      kind: "function",
      status: "kept",
      before: sideOf(ref) === "before" ? [ref] : [],
      after: sideOf(ref) === "after" ? [ref] : [],
    });

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 pt-6">
        <div className="max-w-prose">
          <h2 className="text-lg font-semibold">Аналитическое заключение</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Сравнение комплекта «До» ({result.editions.before.label}
            {result.editions.before.date ? `, ${result.editions.before.date}` : ""}) с комплектом «После» (
            {result.editions.after.label}
            {result.editions.after.date ? `, ${result.editions.after.date}` : ""}). Выводы носят рекомендательный
            характер и требуют проверки ответственным сотрудником.
          </p>
        </div>

        {result.conclusion.sections.map((section, i) => (
          <section key={section.title} className="flex flex-col gap-3">
            {i > 0 && <Separator />}
            <h3 className="text-base font-semibold">{section.title}</h3>
            <ul className="flex flex-col gap-3">
              {section.items.map((item, j) => (
                <li key={j} className="flex flex-col gap-1.5">
                  <p className="max-w-prose text-sm leading-relaxed">{item.text}</p>
                  {item.refs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.refs.map((ref, k) => (
                        <RefButton key={k} ref_={ref} size="xs" onClick={() => openRef(item.text, ref)} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {result.conclusion.limitations.length > 0 && (
          <Alert>
            <Info className="size-4" aria-hidden="true" />
            <AlertTitle>Ограничения анализа</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {result.conclusion.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
