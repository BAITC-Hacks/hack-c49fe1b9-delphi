"use client";

import {
  useMutation,
  useIsMutating,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowLeft, ArrowLeftRight, FileDown, FileText, Files, GitCompareArrows, Languages, ListChecks, ListTodo, LoaderCircle, Network, Play, RotateCcw, SearchX, Table2, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { StatusBadge } from "@/components/custom-ui/status-badge";
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
import { ReviewQueue } from "./review-queue";
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
  const pendingReviews = useIsMutating({ mutationKey: ["review", runId] });
  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => resultsApi.run(runId),
    refetchInterval: (query) =>
      query.state.data && runIsActive(query.state.data.state) ? 2_000 : false,
  });
  const settled =
    run.data?.state === "completed" || run.data?.state === "partial";
  const savedAfterStop =
    (run.data?.state === "failed" || run.data?.state === "interrupted") &&
    (run.data.finding_count > 0 || run.data.units.length > 0);
  const ready = settled || savedAfterStop;
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
  const resume = useMutation({
    mutationFn: () => resultsApi.resume(runId),
    onSuccess: async (accepted) => {
      await Promise.all([
        client.cancelQueries({ queryKey: ["run", runId] }),
        client.cancelQueries({ queryKey: ["findings", runId] }),
        client.cancelQueries({ queryKey: ["functions", runId] }),
      ]);
      client.setQueryData<RunDetail>(["run", runId], (current) =>
        current
          ? {
              ...current,
              state: accepted.state,
              stage: "queued",
              resume_available: false,
            }
          : current,
      );
      update({ finding: null, source: null });
      client.removeQueries({ queryKey: ["translation", runId] });
      client.removeQueries({ queryKey: ["report", runId] });
      for (const finding of findings.data ?? []) {
        client.removeQueries({ queryKey: ["evidence", finding.id] });
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ["run", runId] }),
        client.invalidateQueries({ queryKey: ["analysis", analysis.id] }),
        client.invalidateQueries({ queryKey: ["analyses"] }),
        client.invalidateQueries({ queryKey: ["findings", runId], refetchType: "none" }),
        client.invalidateQueries({ queryKey: ["functions", runId], refetchType: "none" }),
      ]);
      toast.success(
        t(
          "Продолжение сохранённого анализа поставлено в очередь",
          "Сақталған талдауды жалғастыру кезекке қойылды",
          "The saved analysis is queued to continue",
        ),
      );
    },
    onError: (error) => {
      void client.invalidateQueries({ queryKey: ["run", runId] });
      toast.error(getErrorMessage(error));
    },
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
  const reviewMode = params.get("view") === "review";
  const requestedTab = params.get("tab");
  const tab =
    requestedTab === "structure" || requestedTab === "conclusion"
      ? requestedTab
      : "functions";
  const sourceError = sourceQueries.find((query) => query.isError);
  const sources = sourceQueries.flatMap((query) => query.data ?? []);
  const pendingCount = originalFindings.filter((finding) => finding.review.status === "unreviewed").length;

  function openReview() {
    update({ tab: "functions", view: "review", review: "unreviewed", q: null, change: null, issue: null, unit: null, finding: null, source: null });
  }

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
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <Link href="/" className="inline-flex items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t("История", "Тарих", "History")}
        </Link>
        {(["before", "after"] as const).map((side) => {
          const documents = analysis.documents.filter((document) => document.side === side);
          const labels = [...new Set(documents.map((document) => document.revision_label || document.filename))];
          return (
            <Badge key={side} variant="outline" className="max-w-full break-words bg-card font-normal whitespace-normal [overflow-wrap:anywhere]" title={labels.join(" · ")}>
              <Files className="size-3" aria-hidden="true" />
              {side === "before" ? t("До", "Дейін", "Before") : t("После", "Кейін", "After")}: {labels.slice(0, 2).join(" · ") || "—"}
              {labels.length > 2 ? ` +${labels.length - 2}` : ""}
            </Badge>
          );
        })}
      </div>
      <div className="flex flex-col gap-4 border-b pb-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-2.5">
          <h1 className="break-words text-2xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]">
            {analysis.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.state} />
            <span className="text-xs text-muted-foreground">
              {t("Язык результата", "Нәтиже тілі", "Result language")}:{" "}
              {data.output_language.toUpperCase()}
            </span>
          </div>
          {ready ? (
            <p className="text-sm text-muted-foreground">
              {data.units.length} {t("подразделений и ролей", "бөлімше мен рөл", "units and roles")} · {data.coverage.before_functions + data.coverage.after_functions} {t("функций", "функция", "functions")} · {data.finding_count} {t("выводов", "қорытынды", "findings")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:max-w-[30rem] xl:justify-end [&_button]:h-auto [&_button]:min-h-9 [&_button]:whitespace-normal">
          {ready ? (
            <Button size="sm" onClick={openReview} disabled={!findings.isSuccess}>
              <ListChecks className="size-4" />
              {t("Проверить выводы", "Қорытындыларды тексеру", "Review findings")}{findings.isSuccess ? ` (${pendingCount})` : ""}
            </Button>
          ) : null}
          {settled ? (
            <Button size="sm" variant="outline" onClick={() => update({ tab: "conclusion", source: null })}>
              <FileDown className="size-4" />{t("Заключение и экспорт", "Қорытынды және экспорт", "Report and export")}
            </Button>
          ) : null}
          {data.resume_available ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => resume.mutate()}
              disabled={resume.isPending || repeat.isPending || active || pendingReviews > 0 || translation.isFetching}
            >
              {resume.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
              {resume.isPending
                ? t("Продолжение…", "Жалғастырылуда…", "Continuing…")
                : t("Продолжить анализ", "Талдауды жалғастыру", "Continue analysis")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => repeat.mutate()}
            disabled={repeat.isPending || resume.isPending || active}
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
      </div>
      {repeat.isError ? <RequestError error={repeat.error} /> : null}
      {resume.isError ? <RequestError error={resume.error} /> : null}
      {data.resume_available ? (
        <p className="text-sm text-muted-foreground">
          {t(
            "Продолжение использует сохранённый прогресс и исходные документы. После сохранения решения или заметки проверяющего доступен только новый черновик.",
            "Жалғастыру сақталған барыс пен бастапқы құжаттарды пайдаланады. Тексерушінің шешімі немесе ескертпесі сақталғаннан кейін тек жаңа жоба қолжетімді.",
            "Continue uses saved progress and the original documents. After saving a review decision or note, use a new draft.",
          )}
        </p>
      ) : null}
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
          {savedAfterStop
            ? t(
                "Обработка остановилась. Ниже показаны сохранённые выводы и источники; проверка всего комплекта не завершена.",
                "Өңдеу тоқтады. Төменде сақталған қорытындылар мен дереккөздер көрсетілген; жиынтықты толық тексеру аяқталған жоқ.",
                "Processing stopped. Saved findings and sources are shown below; the full document set has not been checked.",
              )
            : t(
                "Сохранённых выводов пока нет. Проверьте ошибки выше и продолжите анализ, если действие доступно, или создайте новый черновик.",
                "Сақталған қорытындылар әзірге жоқ. Жоғарыдағы қателерді тексеріп, мүмкіндік болса талдауды жалғастырыңыз немесе жаңа жоба жасаңыз.",
                "No findings have been saved yet. Review the errors above, then continue if available or create a new draft.",
              )}
        </p>
      ) : null}
      {ready ? (
        <>
          {settled && locale !== data.output_language ? (
            <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Languages className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
                <p className="min-w-48 flex-1 text-xs leading-relaxed text-muted-foreground">
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
                  size="sm"
                  variant="outline"
                  className="h-auto min-h-8 whitespace-normal"
                  disabled={
                    translation.isFetching || Boolean(availableTranslation) || resume.isPending
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
            findings={originalFindings}
            unavailable={!findings.isSuccess}
            onFilter={(filter) =>
              update({
                tab: "functions",
                view: "review",
                finding: null,
                source: null,
                q: null,
                change: null,
                issue: null,
                review: null,
                unit: null,
                ...filter,
              })
            }
          />
          <Tabs value={tab} onValueChange={(value) => update({ tab: value, source: null })}>
            <div className="overflow-x-auto border-b pb-1">
            <TabsList variant="line" className="min-w-max justify-start gap-3 p-0 group-data-[orientation=horizontal]/tabs:h-11">
              <TabsTrigger value="structure" className="flex-none gap-2 px-3 data-[state=active]:text-primary after:bg-primary">
                <Network className="size-4" aria-hidden="true" />
                {t("Структура", "Құрылым", "Structure")}
              </TabsTrigger>
              <TabsTrigger value="functions" className="flex-none gap-2 px-3 data-[state=active]:text-primary after:bg-primary">
                <GitCompareArrows className="size-4" aria-hidden="true" />
                {t(
                  "Функции и риски",
                  "Функциялар мен тәуекелдер",
                  "Functions and risks",
                )}
              </TabsTrigger>
              <TabsTrigger value="conclusion" className="flex-none gap-2 px-3 data-[state=active]:text-primary after:bg-primary">
                <FileText className="size-4" aria-hidden="true" />
                {t("Заключение", "Қорытынды", "Conclusion")}
              </TabsTrigger>
            </TabsList>
            </div>
            <TabsContent value="structure" className="mt-4">
              <StructureView
                run={data}
                translation={availableTranslation?.payload.structure}
                documents={analysis.documents}
                sources={sources}
                onSource={(id) => update({ source: id })}
              />
            </TabsContent>
            <TabsContent value="functions" className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {reviewMode
                    ? t("Вопросы по приоритету · исходные цитаты · решение человека", "Маңыздылығы бойынша сұрақтар · бастапқы дәйексөздер · адамның шешімі", "Priority questions · original quotations · human decisions")
                    : t("Все функции и риски с поиском и фильтрами", "Іздеу мен сүзгілері бар барлық функциялар мен тәуекелдер", "All functions and risks with search and filters")}
                </p>
                <div role="group" className="inline-flex shrink-0 rounded-lg border bg-card p-1" aria-label={t("Вид результатов", "Нәтиже көрінісі", "Results view")}>
                  <Button size="sm" variant={reviewMode ? "secondary" : "ghost"} aria-pressed={reviewMode} onClick={() => update({ view: "review" })}>
                    <ListTodo className="size-4" />{t("Очередь", "Кезек", "Queue")}
                  </Button>
                  <Button size="sm" variant={reviewMode ? "ghost" : "secondary"} aria-pressed={!reviewMode} onClick={() => update({ view: null })}>
                    <Table2 className="size-4" />{t("Таблица", "Кесте", "Table")}
                  </Button>
                </div>
              </div>
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
              {findings.isSuccess && functions.isSuccess && reviewMode ? (
                <ReviewQueue
                  findings={originalFindings}
                  functions={functions.data}
                  sources={sources}
                  run={data}
                  analysisId={analysis.id}
                  documents={analysis.documents}
                  translations={translated}
                  canReview={settled}
                  reviewDisabled={resume.isPending || pendingReviews > 0}
                  onSource={(id) => update({ source: id })}
                />
              ) : null}
              {findings.isSuccess && functions.isSuccess && !reviewMode ? (
                <div
                  className={`grid min-w-0 items-start gap-5 ${selected ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" : ""}`}
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
                      documents={analysis.documents}
                      canReview={settled}
                      reviewDisabled={resume.isPending}
                      onSource={(id) => update({ source: id })}
                      onClose={() => update({ finding: null })}
                    />
                  ) : null}
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="conclusion" className="mt-4">
              {settled ? (
                <ConclusionView run={data} translation={availableTranslation} />
              ) : (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                  {t(
                    "Заключение и экспорт доступны после завершения обработки. Сохранённые источники и выводы можно открыть в соседних вкладках.",
                    "Қорытынды мен экспорт өңдеу аяқталғаннан кейін қолжетімді. Сақталған дереккөздер мен қорытындыларды көрші қойындылардан ашуға болады.",
                    "The report and exports become available when processing finishes. Saved sources and findings remain available in the other tabs.",
                  )}
                </p>
              )}
            </TabsContent>
          </Tabs>
        </>
      ) : null}
      <SourcePanel
        sourceId={sourceId}
        findingId={selected?.id}
        analysisId={analysis.id}
        documents={analysis.documents}
        onClose={() => update({ source: null })}
        onSelect={(id) => update({ source: id })}
      />
    </div>
  );
}

function ResultCounts({
  findings,
  unavailable,
  onFilter,
}: {
  findings: Awaited<ReturnType<typeof resultsApi.findings>>;
  unavailable: boolean;
  onFilter: (filter: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const { params } = useResultsLocation();
  const cards: { label: string; count: number; filter: Record<string, string>; tone: string; icon: LucideIcon }[] = [
    {
      label: t("Соответствие не найдено", "Сәйкестік табылмады", "No match found"),
      count: findings.filter((finding) => finding.change_type === "potentially_missing").length,
      filter: { change: "potentially_missing" },
      tone: "border-l-status-missing-fg text-status-missing-fg",
      icon: SearchX,
    },
    {
      label: t("Передано, разделено, объединено", "Берілген, бөлінген, біріктірілген", "Transferred, split or merged"),
      count: findings.filter((finding) => ["transferred", "split", "merged"].includes(finding.change_type)).length,
      filter: { change: "reassigned" },
      tone: "border-l-status-transferred-fg text-status-transferred-fg",
      icon: ArrowLeftRight,
    },
    {
      label: t("Пересечения и другие вопросы", "Қабаттасулар және басқа сұрақтар", "Overlaps and other questions"),
      count: findings.filter(hasIssue).length,
      filter: { issue: "questions" },
      tone: "border-l-status-conflict-fg text-status-conflict-fg",
      icon: TriangleAlert,
    },
    {
      label: t("Ждут решения человека", "Адамның шешімін күтуде", "Awaiting human review"),
      count: findings.filter(
        (finding) => finding.review.status === "unreviewed",
      ).length,
      filter: { review: "unreviewed" },
      tone: "border-l-primary text-primary",
      icon: ListChecks,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => {
        const selected = params.get("tab") !== "structure" && params.get("tab") !== "conclusion" && Object.entries(card.filter).every(([key, value]) => params.get(key) === value);
        return (
        <Button
          key={card.label}
          variant="outline"
          className={`h-full min-w-0 flex-col items-start justify-start gap-2.5 border-l-4 bg-card p-3 text-left whitespace-normal sm:p-4 ${card.tone} ${selected ? "ring-2 ring-primary/30" : ""}`}
          disabled={unavailable}
          onClick={() => onFilter(card.filter)}
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums text-foreground">{unavailable ? "—" : card.count}</span>
            <card.icon className="size-4 shrink-0" aria-hidden="true" />
          </span>
          <span className="text-xs leading-relaxed font-medium">{card.label}</span>
        </Button>
      );})}
    </div>
  );
}
