"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/shared/api/errors";
import type { RunDetail, TranslationResponse } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { resultsApi, saveFile } from "../api/results-api";
import { RequestError } from "./request-error";

export function ConclusionView({
  run,
  translation,
}: {
  run: RunDetail;
  translation?: TranslationResponse;
}) {
  const { locale, t } = useI18n();
  const translated =
    translation?.run_id === run.id &&
    translation.review_revision === run.review_revision &&
    translation.locale === locale;
  const reportLocale = translated ? locale : run.output_language;
  const frame = useRef<HTMLIFrameElement>(null);
  const report = useQuery({
    queryKey: ["report", run.id, run.review_revision, reportLocale],
    queryFn: () => resultsApi.report(run.id, reportLocale),
    retry: false,
  });
  const csv = useMutation({
    mutationFn: () => resultsApi.csv(run.id, locale),
    onSuccess: (content) => {
      saveFile(
        content,
        `delphi-${run.id}-${locale}.csv`,
        "text/csv;charset=utf-8",
      );
      toast.success(t("CSV сохранён", "CSV сақталды", "CSV downloaded"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  function printReport() {
    const target = frame.current?.contentWindow;
    if (!target) return;
    target.focus();
    target.print();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">
            {t("Заключение", "Қорытынды", "Conclusion")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "Сохранённые выводы и текущие отметки проверки",
              "Сақталған қорытындылар мен ағымдағы тексеру белгілері",
              "Saved findings and current human reviews",
            )}{" "}
            · {t("Редакция проверки", "Тексеру нұсқасы", "Review revision")}{" "}
            {run.review_revision}
          </p>
          <p className="mt-1 text-sm font-medium">
            {reportLocale === run.output_language
              ? t(
                  "Оригинал заключения",
                  "Қорытындының түпнұсқасы",
                  "Original report",
                )
              : t(
                  "Переведённое заключение",
                  "Аударылған қорытынды",
                  "Translated report",
                )}
            {": "}
            {reportLocale.toUpperCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!report.data || report.isFetching}
            onClick={() => {
              if (report.data)
                saveFile(
                  report.data,
                  `delphi-${run.id}-${reportLocale}.html`,
                  "text/html;charset=utf-8",
                );
            }}
          >
            <Download className="size-4" />
            HTML
          </Button>
          <Button
            variant="outline"
            disabled={!report.data || report.isFetching}
            onClick={printReport}
          >
            <Printer className="size-4" />
            {t("Печать / PDF", "Басып шығару / PDF", "Print / PDF")}
          </Button>
          <Button
            variant="outline"
            disabled={csv.isPending}
            onClick={() => csv.mutate()}
          >
            <Download className="size-4" />
            {csv.isPending
              ? t("Подготовка…", "Дайындалуда…", "Preparing…")
              : "CSV"}
          </Button>
        </div>
      </div>
      {reportLocale !== locale ? (
        <p className="rounded-md border bg-muted p-3 text-sm">
          {t(
            "Оригинал доступен для просмотра и экспорта. Чтобы получить заключение на языке интерфейса, нажмите «Перевести пояснения» выше. После изменения проверки потребуется новый перевод.",
            "Түпнұсқаны қарауға және экспорттауға болады. Интерфейс тіліндегі қорытынды үшін жоғарыдағы «Түсіндірмелерді аудару» түймесін басыңыз. Тексеру өзгергеннен кейін жаңа аударма қажет.",
            "The original remains available to view and export. Use Translate explanations above for a report in the interface language. A new translation is needed after review changes.",
          )}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t(
          "В HTML включены подтверждённые, непроверенные и отклонённые выводы отдельно. CSV содержит функции и исходные формулировки.",
          "HTML ішінде расталған, тексерілмеген және қабылданбаған қорытындылар бөлек көрсетіледі. CSV функциялар мен бастапқы тұжырымдарды қамтиды.",
          "HTML separates confirmed, unreviewed and rejected findings. CSV contains the function table and original wording.",
        )}
      </p>
      {report.isPending ? (
        <p role="status">
          {t(
            "Подготовка заключения…",
            "Қорытынды дайындалуда…",
            "Loading report…",
          )}
        </p>
      ) : null}
      {report.isError ? (
        <RequestError
          error={report.error}
          retry={() => {
            void report.refetch();
          }}
        />
      ) : null}
      {csv.isError ? <RequestError error={csv.error} /> : null}
      {report.data ? (
        <iframe
          ref={frame}
          title={t(
            "Предпросмотр заключения",
            "Қорытындыны алдын ала қарау",
            "Report preview",
          )}
          srcDoc={report.data}
          sandbox="allow-same-origin allow-modals"
          className="h-[70vh] min-h-96 w-full rounded-lg border bg-white"
        />
      ) : null}
    </div>
  );
}
