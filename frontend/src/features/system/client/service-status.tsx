"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n";
import { loadHealth } from "../api/health";

export function ServiceStatus() {
  const { t } = useI18n();
  const health = useQuery({ queryKey: ["health"], queryFn: loadHealth, staleTime: 15_000, refetchInterval: 30_000 });
  if (health.isError) return <Alert variant="destructive" className="mb-5">
    <AlertTitle>{t("Сервис документов недоступен", "Құжаттар қызметі қолжетімсіз", "Document service is unavailable")}</AlertTitle>
    <AlertDescription>{t("Проверьте подключение к серверу и повторите запрос.", "Серверге қосылымды тексеріп, сұрауды қайталаңыз.", "Check the server connection and retry.")}<Button variant="outline" size="sm" onClick={() => { void health.refetch(); }}>{t("Повторить", "Қайталау", "Retry")}</Button></AlertDescription>
  </Alert>;
  if (health.data && !health.data.ai_configured) return <Alert className="mb-5 border-status-missing-fg/20 bg-status-missing-bg/40 text-status-missing-fg">
    <AlertTitle>{t("AI-анализ пока недоступен", "AI талдауы әзірге қолжетімсіз", "AI analysis is not configured yet")}</AlertTitle>
    <AlertDescription>{t("Можно создавать сравнения, загружать документы и проверять исходные пункты. Для анализа администратору нужно настроить провайдера AI на сервере.", "Салыстырулар жасауға, құжаттарды жүктеуге және бастапқы тармақтарды тексеруге болады. Талдау үшін әкімші серверде AI провайдерін баптауы қажет.", "You can create comparisons, upload documents, and inspect source clauses. An administrator must configure the AI provider to enable analysis.")}</AlertDescription>
  </Alert>;
  return null;
}
