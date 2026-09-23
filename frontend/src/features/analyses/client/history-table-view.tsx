"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, ArrowUpDown, Copy, Loader2, Plus, Search } from "lucide-react";
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
          {t("Сравнение", "Салыстыру", "Comparison")} <ArrowUpDown className="size-3.5" aria-hidden="true" />
        </Button>
      ),
      cell: ({ row }) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={row.original.state === "draft" ? `/new?analysis=${row.original.id}` : `/analyses/${row.original.id}`}>
          {row.original.title}
        </Link>
      ),
    },
    { accessorKey: "state", header: t("Состояние", "Күйі", "Status"), cell: ({ row }) => <StatusBadge status={row.original.state} /> },
    {
      accessorKey: "created_at",
      header: t("Создано", "Құрылған", "Created"),
      cell: ({ row }) => <time dateTime={row.original.created_at} className="whitespace-nowrap">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.original.created_at))}</time>,
    },
    {
      id: "actions",
      header: t("Действия", "Әрекеттер", "Actions"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
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
          <h1 className="text-2xl font-semibold tracking-tight">{t("История сравнений", "Салыстырулар тарихы", "Comparison history")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("Сравнивайте документы, проверяйте передачу обязанностей и сохраняйте выводы с источниками.", "Құжаттарды салыстырыңыз, міндеттердің берілуін тексеріңіз және дереккөздері бар қорытындыларды сақтаңыз.", "Compare documents, trace changes in responsibility, and save findings with their sources.")}</p>
        </div>
        <Link href="/new" className={buttonVariants()}><Plus className="size-4" aria-hidden="true" />{t("Новое сравнение", "Жаңа салыстыру", "New comparison")}</Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-9" value={search} onChange={(event) => { setSearch(event.target.value); table.setPageIndex(0); }} placeholder={t("Найти сравнение", "Салыстыруды іздеу", "Find a comparison")} aria-label={t("Поиск по названию", "Атау бойынша іздеу", "Search by title")} />
        </div>
        <Select value={filter} onValueChange={(value) => { setFilter(value); table.setPageIndex(0); }}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t("Фильтр состояния", "Күй сүзгісі", "Filter by status")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Все состояния", "Барлық күйлер", "All statuses")}</SelectItem>
            {(["draft", "queued", "running", "completed", "partial", "failed", "interrupted"] as const).map((state) => <SelectItem key={state} value={state}><StatusBadge status={state} /></SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => analyses.refetch()} disabled={analyses.isFetching}>{t("Обновить", "Жаңарту", "Refresh")}</Button>
      </div>
      {analyses.isError ? <Alert variant="destructive"><AlertTitle>{t("История недоступна", "Тарих қолжетімсіз", "History unavailable")}</AlertTitle><AlertDescription>{getErrorMessage(analyses.error)}</AlertDescription></Alert> : null}
      {analyses.isPending ? <div className="space-y-3" aria-label={t("Загрузка истории", "Тарих жүктелуде", "Loading history")}><Skeleton className="h-12 w-full" /><Skeleton className="h-32 w-full" /></div> : <DataTable table={table} emptyMessage={search || filter !== "all" ? t("Сравнения не найдены", "Салыстырулар табылмады", "No matching comparisons") : t("Создайте сравнение и загрузите комплекты «До» и «После».", "Салыстыру жасап, «Дейін» және «Кейін» құжаттарын жүктеңіз.", "Create a comparison and upload before and after documents.")} />}
      <p className="text-xs text-muted-foreground">{t("Повтор создаёт новый черновик с копией документов. Предыдущий результат сохраняется.", "Қайталау құжаттардың көшірмесі бар жаңа нобай жасайды. Алдыңғы нәтиже сақталады.", "Repeat creates a new draft with copied documents. The previous result stays unchanged.")}</p>
    </div>
  );
}
