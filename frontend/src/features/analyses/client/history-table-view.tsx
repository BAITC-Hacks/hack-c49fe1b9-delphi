"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, ArrowUpDown, Copy, FolderOpen, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "@/shared/notifications";
import { StatusBadge } from "@/components/custom-ui/status-badge";
import { DataTable } from "@/components/data-table/data-table";
import { useDataTable } from "@/components/data-table/use-data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { copyAnalysis, loadAnalyses } from "@/features/analyses/api/analyses";
import { getErrorMessage } from "@/shared/api/errors";
import type { AnalysisListItem } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";

export function HistoryTableView() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const analyses = useQuery({
    queryKey: ["analyses"],
    queryFn: loadAnalyses,
    refetchInterval: (query) => query.state.data?.some((item) => ["queued", "running"].includes(item.state)) ? 5000 : false,
  });
  const repeat = useMutation({
    mutationFn: copyAnalysis,
    onSuccess: (analysis) => {
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      toast.success(t("Копия документов сохранена в новом черновике", "Құжаттардың көшірмесі жаңа нобайда сақталды", "Documents copied into a new draft"));
      router.push(`/new?analysis=${analysis.id}`);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const columns: ColumnDef<AnalysisListItem>[] = [
    {
      accessorKey: "title",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
          {t("Название", "Атауы", "Name")} <ArrowUpDown className="size-3.5" aria-hidden="true" />
        </Button>
      ),
      cell: ({ row }) => (
        <Link className="block min-w-48 max-w-xl whitespace-normal font-medium leading-relaxed underline-offset-4 hover:text-primary hover:underline" href={row.original.state === "draft" ? `/new?analysis=${row.original.id}` : `/analyses/${row.original.id}`}>
          {row.original.title}
        </Link>
      ),
    },
    {
      accessorKey: "created_at",
      header: t("Дата", "Күні", "Date"),
      cell: ({ row }) => <time dateTime={row.original.created_at} className="whitespace-nowrap text-muted-foreground">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.original.created_at))}</time>,
    },
    { accessorKey: "state", header: t("Состояние", "Күйі", "Status"), cell: ({ row }) => <StatusBadge status={row.original.state} /> },
    {
      id: "actions",
      header: t("Действия", "Әрекеттер", "Actions"),
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1.5">
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={row.original.state === "draft" ? `/new?analysis=${row.original.id}` : `/analyses/${row.original.id}`}>
            {row.original.state === "draft" ? t("Продолжить", "Жалғастыру", "Continue") : t("Открыть", "Ашу", "Open")} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
          <Button variant="ghost" size="sm" disabled={repeat.isPending} onClick={() => repeat.mutate(row.original.id)} aria-label={`${t("Повторить", "Қайталау", "Repeat")}: ${row.original.title}`}>
            {repeat.isPending && repeat.variables === row.original.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {t("Повторить", "Қайталау", "Repeat")}
          </Button>
        </div>
      ),
    },
  ];
  const rows = useMemo(() => (analyses.data ?? []).filter((row) => row.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (filter === "all" || row.state === filter)), [analyses.data, search, filter]);
  const table = useDataTable({ columns, data: rows });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("История анализов", "Талдаулар тарихы", "Analysis history")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("Сравнения комплектов документов «До» и «После» реорганизации.", "Қайта ұйымдастыруға дейінгі және кейінгі құжаттар жиынтықтарын салыстыру.", "Before and After document comparisons for organisational changes.")}</p>
        </div>
        <Link href="/new" className={buttonVariants()}><Plus className="size-4" aria-hidden="true" />{t("Новое сравнение", "Жаңа салыстыру", "New comparison")}</Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="bg-card pl-9" value={search} onChange={(event) => { setSearch(event.target.value); table.setPageIndex(0); }} placeholder={t("Найти сравнение", "Салыстыруды іздеу", "Find a comparison")} aria-label={t("Поиск по названию", "Атау бойынша іздеу", "Search by title")} />
        </div>
        <Select value={filter} onValueChange={(value) => { setFilter(value); table.setPageIndex(0); }}>
          <SelectTrigger className="w-full bg-card sm:w-52" aria-label={t("Фильтр состояния", "Күй сүзгісі", "Filter by status")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Все состояния", "Барлық күйлер", "All statuses")}</SelectItem>
            {(["draft", "queued", "running", "completed", "partial", "failed", "interrupted"] as const).map((state) => <SelectItem key={state} value={state}><StatusBadge status={state} /></SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" className="sm:ml-auto" onClick={() => analyses.refetch()} disabled={analyses.isFetching}><RefreshCw className={analyses.isFetching ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />{t("Обновить", "Жаңарту", "Refresh")}</Button>
      </div>
      {analyses.isError ? <Alert variant="destructive"><AlertTitle>{t("История недоступна", "Тарих қолжетімсіз", "History unavailable")}</AlertTitle><AlertDescription>{getErrorMessage(analyses.error)}<Button variant="outline" size="sm" onClick={() => analyses.refetch()} disabled={analyses.isFetching}>{t("Повторить", "Қайталау", "Retry")}</Button></AlertDescription></Alert> : null}
      {analyses.isPending ? <div className="space-y-3" aria-label={t("Загрузка истории", "Тарих жүктелуде", "Loading history")}><Skeleton className="h-12 w-full" /><Skeleton className="h-32 w-full" /></div> : !analyses.isError && !analyses.data?.length ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border bg-card px-6 py-10 text-center"><FolderOpen className="size-8 text-muted-foreground" aria-hidden="true" /><h2 className="font-semibold">{t("Пока нет анализов", "Талдаулар әлі жоқ", "No analyses yet")}</h2><p className="max-w-sm text-sm text-muted-foreground">{t("Загрузите комплекты документов «До» и «После», чтобы начать сравнение.", "Салыстыруды бастау үшін «Дейін» және «Кейін» құжаттарын жүктеңіз.", "Upload Before and After documents to start a comparison.")}</p><Link href="/new" className={buttonVariants({ variant: "outline", size: "sm" })}>{t("Новое сравнение", "Жаңа салыстыру", "New comparison")}</Link></div> : analyses.data ? <div className="[&_td]:px-4 [&_td]:py-3 [&_th]:px-4"><DataTable table={table} emptyMessage={t("Сравнения не найдены", "Салыстырулар табылмады", "No matching comparisons")} /></div> : null}
      {analyses.data?.length ? <p className="text-xs text-muted-foreground">{t("Повтор создаёт новый черновик с копией документов. Предыдущий результат сохраняется.", "Қайталау құжаттардың көшірмесі бар жаңа нобай жасайды. Алдыңғы нәтиже сақталады.", "Repeat creates a new draft with copied documents. The previous result stays unchanged.")}</p> : null}
    </div>
  );
}
