"use client";

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, RotateCcw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getErrorMessage } from "@/shared/api/errors";
import type { AnalysisDetail, RunDetail } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { resultsApi } from "../api/results-api";
import { hasIssue, runIsActive, stageLabel } from "../model/labels";
import { ConclusionView } from "./conclusion-view";
import { CoverageSummary } from "./coverage-summary";
import { FindingDetail } from "./finding-detail";
import { FindingsTableView } from "./findings-table-view";
import { RequestError } from "./request-error";
import { SourcePanel } from "./source-panel";
import { StructureView } from "./structure-view";
import { useResultsLocation } from "./use-results-location";

export function ResultsWorkspace({ analysisId }: { analysisId: string }) {
  const { t } = useI18n();
  const analysis = useQuery({
    queryKey: ["analysis", analysisId],
    queryFn: () => resultsApi.analysis(analysisId),
  });
  if (analysis.isPending)
    return (
      <p role="status">
        {t("Загрузка анализа…", "Талдау жүктелуде…", "Loading analysis…")}
      </p>
    );
  if (analysis.isError)
    return (
      <RequestError
        error={analysis.error}
        retry={() => {
          void analysis.refetch();
        }}
      />
    );
  if (!analysis.data.run)
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{analysis.data.title}</h1>
        <p>
          {t(
            "Это черновик. Добавьте документы и запустите сравнение.",
            "Бұл жоба. Құжаттарды қосып, салыстыруды іске қосыңыз.",
            "This comparison is a draft. Add documents and start a run.",
          )}
        </p>
        <Link
          href={`/new?analysis=${analysisId}` as Route}
          className={buttonVariants()}
        >
          {t("Открыть черновик", "Жобаны ашу", "Open draft")}
        </Link>
      </div>
    );
  return <RunWorkspace analysis={analysis.data} runId={analysis.data.run.id} />;
}

function RunWorkspace({
  analysis,
  runId,
}: {
  analysis: AnalysisDetail;
  runId: string;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const client = useQueryClient();
  const { params, update } = useResultsLocation();
  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => resultsApi.run(runId),
    refetchInterval: (query) =>
      query.state.data && runIsActive(query.state.data.state) ? 2_000 : false,
  });
  const ready =
    run.data?.state === "completed" || run.data?.state === "partial";
  const findings = useQuery({
    queryKey: ["findings", runId],
    queryFn: () => resultsApi.findings(runId),
    enabled: ready,
  });
  const functions = useQuery({
    queryKey: ["functions", runId],
    queryFn: () => resultsApi.functions(runId),
    enabled: ready,
  });
  const sourceQueries = useQueries({
    queries: analysis.documents.map((document) => ({
      queryKey: ["document-sources", analysis.id, document.id],
      queryFn: () => resultsApi.documentSources(analysis.id, document.id),
      enabled: ready,
      staleTime: Infinity,
    })),
  });
  const translation = useQuery({
    queryKey: ["translation", runId, run.data?.review_revision, locale],
    queryFn: () => resultsApi.translate(runId, locale),
    enabled: false,
    retry: false,
    staleTime: Infinity,
  });
  const repeat = useMutation({
    mutationFn: () => resultsApi.repeat(analysis.id),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ["analyses"] });
      toast.success(
        t(
          "Создана копия для нового сравнения",
          "Жаңа салыстыру үшін көшірме жасалды",
          "A new draft copy is ready",
        ),
      );
      router.push(`/new?analysis=${created.id}` as Route);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const previousState = useRef<RunDetail["state"] | null>(null);
  useEffect(() => {
    const state = run.data?.state;
    if (!state) return;
    if (
      previousState.current &&
      runIsActive(previousState.current) &&
      !runIsActive(state)
    ) {
      if (state === "completed")
        toast.success(
          t("Анализ завершён", "Талдау аяқталды", "Analysis completed"),
        );
      else if (state === "partial")
        toast.info(
          t(
            "Анализ завершён с ограничениями",
            "Талдау шектеулермен аяқталды",
            "Analysis completed with limitations",
          ),
        );
      else
        toast.error(
          t(
            "Анализ не завершён. Откройте ошибки запуска.",
            "Талдау аяқталмады. Іске қосу қателерін ашыңыз.",
            "Analysis did not complete. Review the run errors.",
          ),
        );
    }
    previousState.current = state;
  }, [run.data?.state, t]);

  if (run.isPending)
    return (
      <p role="status">
        {t("Загрузка результата…", "Нәтиже жүктелуде…", "Loading result…")}
      </p>
    );
  if (run.isError)
    return (
      <RequestError
        error={run.error}
        retry={() => {
          void run.refetch();
        }}
      />
    );

  const data = run.data;
  const active = runIsActive(data.state);
  const originalFindings = findings.data ?? [];
  const availableTranslation =
    translation.data?.run_id === runId &&
    translation.data.review_revision === data.review_revision &&
    translation.data.locale === locale
      ? translation.data
      : undefined;
  const translated = new Map(
    availableTranslation?.payload.findings.map((item) => [item.id, item]) ?? [],
  );
  const visibleFindings = originalFindings.map((finding) => ({
    ...finding,
    ...translated.get(finding.id),
  }));
  const selectedId = params.get("finding");
  const selected = originalFindings.find(
    (finding) => finding.id === selectedId,
  );
  const sourceId = params.get("source");
  const requestedTab = params.get("tab");
  const tab =
    requestedTab === "structure" || requestedTab === "conclusion"
      ? requestedTab
      : "functions";
  const sourceError = sourceQueries.find((query) => query.isError);
  const sources = sourceQueries.flatMap((query) => query.data ?? []);

  async function translate() {
    const result = await translation.refetch();
    if (result.error) toast.error(getErrorMessage(result.error));
    else {
      await client.invalidateQueries({
        queryKey: ["report", runId, data.review_revision, locale],
      });
      toast.success(
        t(
          "Перевод сохранённых пояснений готов",
          "Сақталған түсіндірмелердің аудармасы дайын",
          "Saved explanations translated",
        ),
      );
    }
  }

  return (
    <div className="space-y-5">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("История", "Тарих", "History")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words text-2xl font-semibold">
            {analysis.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={data.state === "failed" ? "destructive" : "secondary"}
            >
              {stageLabel(data.stage, t)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t("Язык результата", "Нәтиже тілі", "Result language")}:{" "}
              {data.output_language.toUpperCase()}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => repeat.mutate()}
          disabled={repeat.isPending || active}
        >
          <RotateCcw className="size-4" />
          {repeat.isPending
            ? t("Создание копии…", "Көшірме жасалуда…", "Copying…")
            : t(
                "Повторить в новом черновике",
                "Жаңа жобада қайталау",
                "Repeat in a new draft",
              )}
        </Button>
      </div>
      {repeat.isError ? <RequestError error={repeat.error} /> : null}
      {active ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border bg-card p-4 text-sm"
        >
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          <div>
            <p className="font-medium">{stageLabel(data.stage, t)}</p>
            <p className="text-muted-foreground">
              {t(
                "Можно вернуться позже: ход анализа сохраняется.",
                "Кейін оралуға болады: талдау барысы сақталады.",
                "You can return later. Run progress is saved.",
              )}
            </p>
          </div>
        </div>
      ) : null}
      <CoverageSummary run={data} documents={analysis.documents} />
      {data.state === "failed" || data.state === "interrupted" ? (
        <p role="alert" className="rounded-lg border p-4 text-sm">
          {t(
            "Рабочий результат не получен. Проверьте ошибки выше и создайте новый черновик для повторного запуска.",
            "Жұмыс нәтижесі алынбады. Жоғарыдағы қателерді тексеріп, қайта іске қосу үшін жаңа жоба жасаңыз.",
            "A usable result was not produced. Review the errors above and create a new draft to retry.",
          )}
        </p>
      ) : null}
      {ready ? (
        <>
          {locale !== data.output_language ? (
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex-1 text-sm">
                  {availableTranslation
                    ? t(
                        "Пояснения переведены. Цитаты и названия сохранены в оригинале.",
                        "Түсіндірмелер аударылды. Дәйексөздер мен атаулар түпнұсқада сақталған.",
                        "Explanations are translated. Quotations and names remain original.",
                      )
                    : t(
                        "Сейчас показаны исходные пояснения. Можно отдельно перевести сохранённый результат; анализ не запускается повторно.",
                        "Қазір бастапқы түсіндірмелер көрсетілген. Сақталған нәтижені бөлек аударуға болады; талдау қайта іске қосылмайды.",
                        "Original explanations are shown. Translate the saved result separately without rerunning analysis.",
                      )}
                </p>
                <Button
                  variant="outline"
                  disabled={
                    translation.isFetching || Boolean(availableTranslation)
                  }
                  onClick={() => {
                    void translate();
                  }}
                >
                  {translation.isFetching
                    ? t("Перевод…", "Аударылуда…", "Translating…")
                    : availableTranslation
                      ? t("Переведено", "Аударылды", "Translated")
                      : t(
                          "Перевести пояснения",
                          "Түсіндірмелерді аудару",
                          "Translate explanations",
                        )}
                </Button>
              </div>
              {translation.isError ? (
                <RequestError error={translation.error} />
              ) : null}
            </div>
          ) : null}
          <ResultCounts
            run={data}
            findings={originalFindings}
            onFilter={(filter) =>
              update({
                tab: "functions",
                q: null,
                change: null,
                issue: null,
                review: null,
                unit: null,
                ...filter,
              })
            }
          />
          <Tabs value={tab} onValueChange={(value) => update({ tab: value })}>
            <TabsList className="h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="structure">
                {t("Структура", "Құрылым", "Structure")}
              </TabsTrigger>
              <TabsTrigger value="functions">
                {t(
                  "Функции и риски",
                  "Функциялар мен тәуекелдер",
                  "Functions and risks",
                )}
              </TabsTrigger>
              <TabsTrigger value="conclusion">
                {t("Заключение", "Қорытынды", "Conclusion")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="structure" className="mt-4">
              <StructureView
                run={data}
                onSource={(id) => update({ source: id })}
              />
            </TabsContent>
            <TabsContent value="functions" className="mt-4 space-y-4">
              {findings.isPending || functions.isPending ? (
                <p role="status">
                  {t(
                    "Загрузка выводов…",
                    "Қорытындылар жүктелуде…",
                    "Loading findings…",
                  )}
                </p>
              ) : null}
              {findings.isError ? (
                <RequestError
                  error={findings.error}
                  retry={() => {
                    void findings.refetch();
                  }}
                />
              ) : null}
              {functions.isError ? (
                <RequestError
                  error={functions.error}
                  retry={() => {
                    void functions.refetch();
                  }}
                />
              ) : null}
              {sourceError ? (
                <RequestError
                  error={sourceError.error}
                  retry={() => {
                    for (const query of sourceQueries)
                      if (query.isError) void query.refetch();
                  }}
                />
              ) : null}
              {selectedId && findings.isSuccess && !selected ? (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 p-4 text-sm"
                >
                  <p>
                    {t(
                      "Вывод из ссылки не найден в этом анализе.",
                      "Сілтемедегі қорытынды бұл талдауда табылмады.",
                      "The linked finding does not belong to this analysis or no longer exists.",
                    )}
                  </p>
                  <Button
                    variant="link"
                    onClick={() => update({ finding: null })}
                  >
                    {t("Закрыть ссылку", "Сілтемені жабу", "Clear selection")}
                  </Button>
                </div>
              ) : null}
              {findings.isSuccess && functions.isSuccess ? (
                <div
                  className={`grid items-start gap-4 ${selected ? "xl:grid-cols-2" : ""}`}
                >
                  <FindingsTableView
                    findings={visibleFindings}
                    functions={functions.data}
                    units={data.units}
                    sources={sources}
                    selectedId={selectedId}
                    onSelect={(id) => update({ finding: id })}
                  />
                  {selected ? (
                    <FindingDetail
                      key={selected.id}
                      finding={selected}
                      functions={functions.data}
                      translation={translated.get(selected.id)}
                      analysisId={analysis.id}
                      onSource={(id) => update({ source: id })}
                      onClose={() => update({ finding: null })}
                    />
                  ) : null}
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="conclusion" className="mt-4">
              <ConclusionView run={data} translation={availableTranslation} />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
      <SourcePanel
        sourceId={sourceId}
        analysisId={analysis.id}
        documents={analysis.documents}
        onClose={() => update({ source: null })}
        onSelect={(id) => update({ source: id })}
      />
    </div>
  );
}

function ResultCounts({
  run,
  findings,
  onFilter,
}: {
  run: RunDetail;
  findings: Awaited<ReturnType<typeof resultsApi.findings>>;
  onFilter: (filter: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const cards = [
    {
      label: t("Все выводы", "Барлық қорытындылар", "All findings"),
      count: run.finding_count,
      filter: {},
    },
    {
      label: t("Переданные функции", "Берілген функциялар", "Transfers"),
      count: findings.filter((finding) => finding.change_type === "transferred")
        .length,
      filter: { change: "transferred" },
    },
    {
      label: t("Вопросы", "Сұрақтар", "Issues"),
      count: findings.filter(hasIssue).length,
      filter: { issue: "questions" },
    },
    {
      label: t("Не проверены", "Тексерілмеген", "Unreviewed"),
      count: findings.filter(
        (finding) => finding.review.status === "unreviewed",
      ).length,
      filter: { review: "unreviewed" },
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Button
          key={card.label}
          variant="outline"
          className="h-auto flex-col items-start whitespace-normal p-3 text-left"
          onClick={() => onFilter(card.filter as Record<string, string>)}
        >
          <span className="text-xl font-semibold">{card.count}</span>
          <span className="text-xs text-muted-foreground">{card.label}</span>
        </Button>
      ))}
    </div>
  );
}
