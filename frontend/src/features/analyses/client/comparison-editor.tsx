"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Files, Loader2, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { StatusBadge } from "@/components/custom-ui/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { addDocument, beginRun, loadAnalysis, saveAnalysis } from "@/features/analyses/api/analyses";
import { comparisonSchema, type ComparisonValues } from "@/features/analyses/model";
import { getErrorMessage } from "@/shared/api/errors";
import type { DocumentResponse, StartRun } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { DocumentCard } from "./document-card";
import { SourcePreview } from "./source-preview";
import { UploadZone } from "./upload-zone";

export function ComparisonEditor({ analysisId }: { analysisId?: string }) {
  return analysisId ? <ExistingComparison key={analysisId} analysisId={analysisId} /> : <CreateComparison />;
}

function CreateComparison() {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<ComparisonValues>({ resolver: zodResolver(comparisonSchema), defaultValues: { title: "" } });
  const create = useMutation({
    mutationFn: ({ title }: ComparisonValues) => saveAnalysis(title),
    onSuccess: (analysis) => {
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      toast.success(t("Черновик сохранён", "Нобай сақталды", "Draft saved"));
      router.replace(`/new?analysis=${analysis.id}`);
    },
    onError: (error) => { form.setError("root", { message: getErrorMessage(error) }); toast.error(getErrorMessage(error)); },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{t("История анализов", "Талдаулар тарихы", "Analysis history")}</Link>
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("Новое сравнение", "Жаңа салыстыру", "New comparison")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("Сравните документы до и после реорганизации.", "Қайта ұйымдастыруға дейінгі және кейінгі құжаттарды салыстырыңыз.", "Compare documents from before and after a reorganisation.")}</p></div>
      <Card className="shadow-none"><CardHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted text-primary"><Files className="size-5" aria-hidden="true" /></div><CardTitle className="text-lg">{t("Назовите сравнение", "Салыстыруға атау беріңіз", "Name your comparison")}</CardTitle><CardDescription>{t("Затем добавьте комплекты «До» и «После». Черновик сохранится в истории.", "Содан кейін «Дейін» және «Кейін» жиынтықтарын қосыңыз. Нобай тарихта сақталады.", "Then add your Before and After documents. The draft will be saved in history.")}</CardDescription></CardHeader><CardContent><form className="space-y-5" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <div className="space-y-2"><Label htmlFor="comparison-title">{t("Название сравнения", "Салыстыру атауы", "Comparison title")}</Label><Input id="comparison-title" autoFocus maxLength={200} disabled={create.isPending} aria-invalid={Boolean(form.formState.errors.title)} {...form.register("title")} placeholder={t("Например, БВА: редакция 8 → 9", "Мысалы, ІАБ: 8 → 9-редакция", "For example, Internal audit: revision 8 → 9")} />{form.formState.errors.title ? <p className="text-sm text-destructive">{t("Введите название от 1 до 200 символов", "1–200 таңбадан тұратын атау енгізіңіз", "Enter a title between 1 and 200 characters")}</p> : null}</div>
        {form.formState.errors.root ? <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
        <Button type="submit" disabled={create.isPending}>{create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}{t("К загрузке документов", "Құжаттарды жүктеуге өту", "Continue to documents")}</Button>
      </form></CardContent></Card>
    </div>
  );
}

function ExistingComparison({ analysisId }: { analysisId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [outputLanguage, setOutputLanguage] = useState<StartRun["output_language"]>(locale);
  const [allowPartial, setAllowPartial] = useState(false);
  const [preview, setPreview] = useState<DocumentResponse | null>(null);
  const [uploadErrors, setUploadErrors] = useState<{ filename: string; message: string }[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const documentMutations = useIsMutating({ mutationKey: ["documents", analysisId] });
  const analysis = useQuery({ queryKey: ["analysis", analysisId], queryFn: () => loadAnalysis(analysisId) });
  const upload = useMutation({
    mutationKey: ["documents", analysisId],
    mutationFn: async ({ side, files }: { side: "before" | "after"; files: File[] }) => {
      const errors: { filename: string; message: string }[] = [];
      let saved = 0;
      for (const [index, file] of files.entries()) {
        setUploadProgress(`${index + 1}/${files.length} · ${file.name}`);
        try { await addDocument(analysisId, side, file); saved += 1; }
        catch (error) { errors.push({ filename: file.name, message: getErrorMessage(error) }); }
      }
      return { errors, saved };
    },
    onSuccess: ({ errors, saved }, { files }) => {
      const attempted = new Set(files.map((file) => file.name));
      setUploadErrors((previous) => [...previous.filter((error) => !attempted.has(error.filename)), ...errors]);
      if (saved) toast.success(`${t("Документы сохранены", "Құжаттар сақталды", "Documents saved")}: ${saved}`);
      if (errors.length) toast.error(`${t("Не удалось загрузить", "Жүктеу мүмкін болмады", "Uploads failed")}: ${errors.length}`);
    },
    onSettled: () => { setUploadProgress(""); queryClient.invalidateQueries({ queryKey: ["analysis", analysisId] }); },
  });
  const start = useMutation({
    mutationFn: (options: StartRun) => beginRun(analysisId, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analysis", analysisId] });
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
      toast.success(t("Анализ поставлен в очередь", "Талдау кезекке қойылды", "Analysis queued"));
      router.push(`/analyses/${analysisId}`);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  if (analysis.isPending) return <div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-72 w-full" /></div>;
  if (analysis.isError) return <Alert variant="destructive"><AlertTitle>{t("Не удалось открыть сравнение", "Салыстыруды ашу мүмкін болмады", "Could not open comparison")}</AlertTitle><AlertDescription>{getErrorMessage(analysis.error)}<Button variant="outline" onClick={() => analysis.refetch()}>{t("Повторить", "Қайталау", "Retry")}</Button><Link href="/" className="underline">{t("К истории", "Тарихқа оралу", "Back to history")}</Link></AlertDescription></Alert>;

  const documents = analysis.data.documents;
  const locked = Boolean(analysis.data.run);
  const busy = documentMutations > 0 || start.isPending || analysis.isFetching;
  const hasPartial = documents.some((document) => document.parse_status === "partial");
  const hasBothSides = documents.some((document) => document.side === "before") && documents.some((document) => document.side === "after");
  const allReadable = documents.every((document) => document.block_count > 0 && ["parsed", "partial"].includes(document.parse_status));
  const ready = hasBothSides && allReadable && (!hasPartial || allowPartial) && !uploadErrors.length && !busy && !locked;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />{t("История анализов", "Талдаулар тарихы", "Analysis history")}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="break-words text-2xl font-semibold tracking-tight">{analysis.data.title}</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("Загрузите документы и проверьте, как они прочитаны. Несколько файлов на каждой стороне образуют один комплект.", "Құжаттарды жүктеп, қалай оқылғанын тексеріңіз. Әр жақтағы бірнеше файл бір жиынтықты құрайды.", "Upload documents and check how they were parsed. Each side can contain multiple files.")}</p></div><StatusBadge status={analysis.data.run?.state ?? "draft"} /></div>
      {locked ? <Alert><AlertTitle>{t("Документы этого запуска зафиксированы", "Осы іске қосудың құжаттары бекітілген", "This run's documents are locked")}</AlertTitle><AlertDescription>{t("Для изменения входных документов создайте повтор из истории.", "Кіріс құжаттарын өзгерту үшін тарихтан қайталау жасаңыз.", "Use Repeat in history to change the input documents.")}<Link className={buttonVariants({ size: "sm" })} href={`/analyses/${analysisId}`}>{t("Открыть результат", "Нәтижені ашу", "Open result")}</Link></AlertDescription></Alert> : null}
      <div className="grid items-start gap-5 md:grid-cols-2">
        {(["before", "after"] as const).map((side) => <section key={side} aria-labelledby={`heading-${side}`} className="min-w-0 space-y-3"><div className="flex items-center justify-between gap-2"><h2 id={`heading-${side}`} className="text-sm font-semibold">{side === "before" ? t("Комплект «До»", "«Дейін» жиынтығы", "Before documents") : t("Комплект «После»", "«Кейін» жиынтығы", "After documents")}</h2><span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground" aria-label={t("Документов", "Құжат саны", "Documents")}>{documents.filter((document) => document.side === side).length}</span></div>
          {!locked ? <UploadZone side={side} disabled={busy} progress={upload.isPending && upload.variables?.side === side ? uploadProgress : undefined} onFiles={(files) => upload.mutate({ side, files })} /> : null}
          {documents.filter((document) => document.side === side).map((document) => <DocumentCard key={`${document.id}:${document.revision_label}`} document={document} locked={locked} busy={busy} onPreview={() => setPreview(document)} />)}
          {!documents.some((document) => document.side === side) ? <p className="px-1 text-xs text-muted-foreground">{t("Документы пока не добавлены", "Құжаттар әлі қосылмаған", "No documents added yet")}</p> : null}
        </section>)}
      </div>
      {uploadErrors.length ? <Alert variant="destructive"><AlertTitle>{t("Часть файлов не сохранена", "Кейбір файлдар сақталмады", "Some files were not saved")}</AlertTitle><AlertDescription><p>{t("Загрузите исправленные файлы повторно или явно исключите их из выбранного комплекта перед запуском.", "Іске қоспас бұрын түзетілген файлдарды қайта жүктеңіз немесе оларды таңдалған жиынтықтан алып тастаңыз.", "Retry the corrected files or explicitly exclude them from the selected set before starting.")}</p><ul className="w-full space-y-2">{uploadErrors.map((error, index) => <li key={`${error.filename}-${index}`} className="flex flex-wrap items-center justify-between gap-2 break-words"><span><strong>{error.filename}</strong>: {error.message}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => setUploadErrors((previous) => previous.filter((_, position) => position !== index))}>{t("Исключить файл", "Файлды алып тастау", "Exclude file")}</Button></li>)}</ul></AlertDescription></Alert> : null}
      {!locked ? <Card className="gap-4 shadow-none"><CardHeader><CardTitle className="text-base">{t("Настройки анализа", "Талдау параметрлері", "Analysis options")}</CardTitle><CardDescription>{t("Выводы будут связаны с исходными пунктами и доступны для проверки.", "Қорытындылар бастапқы тармақтармен байланысып, тексеруге қолжетімді болады.", "Findings will link to original clauses for your review.")}</CardDescription></CardHeader><CardContent className="space-y-5">
        <div className="max-w-xs space-y-2"><Label htmlFor="output-language">{t("Язык пояснений", "Түсіндірмелер тілі", "Explanation language")}</Label><Select value={outputLanguage} onValueChange={(value) => setOutputLanguage(value as StartRun["output_language"])} disabled={busy}><SelectTrigger id="output-language"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ru">Русский</SelectItem><SelectItem value="kk">Қазақша</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{t("Цитаты останутся на языке оригинала.", "Дәйексөздер түпнұсқа тілінде қалады.", "Source quotations stay in their original language.")}</p></div>
        {hasPartial ? <Alert className="border-status-missing-fg/25 bg-status-missing-bg text-status-missing-fg"><AlertTitle>{t("В документах есть ограничения чтения", "Құжаттарды оқуда шектеулер бар", "The documents have parsing limitations")}</AlertTitle><AlertDescription className="text-inherit"><p>{t("Изучите предупреждения выше. Непрочитанные части не войдут в проверку.", "Жоғарыдағы ескертулерді қарап шығыңыз. Оқылмаған бөліктер тексеруге кірмейді.", "Read the notes above. Unreadable content will not be included in the comparison.")}</p><div className="mt-3 flex items-start gap-3"><Checkbox id="allow-partial" checked={allowPartial} onCheckedChange={(checked) => setAllowPartial(checked === true)} disabled={busy} /><Label htmlFor="allow-partial" className="leading-normal">{t("Я ознакомился с ограничениями и разрешаю частичный анализ", "Шектеулермен таныстым және ішінара талдауға рұқсат беремін", "I reviewed the limitations and allow a partial analysis")}</Label></div></AlertDescription></Alert> : null}
        {!hasBothSides ? <p className="text-sm text-muted-foreground">{t("Добавьте хотя бы один документ на каждую сторону.", "Әр жаққа кемінде бір құжат қосыңыз.", "Add at least one document on each side.")}</p> : null}
        {!allReadable ? <p role="alert" className="text-sm text-destructive">{t("Удалите или замените непрочитанные документы перед запуском.", "Іске қоспас бұрын оқылмаған құжаттарды жойыңыз немесе ауыстырыңыз.", "Remove or replace documents without readable text before starting.")}</p> : null}
        {start.isError ? <Alert variant="destructive"><AlertDescription>{getErrorMessage(start.error)}</AlertDescription></Alert> : null}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4"><Button className="w-full sm:w-auto" disabled={!ready} onClick={() => start.mutate({ output_language: outputLanguage, allow_partial: hasPartial && allowPartial })}>{start.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}{t("Начать анализ", "Талдауды бастау", "Start analysis")}</Button><span className="text-xs text-muted-foreground">{t("Выводы требуют проверки человеком.", "Қорытындыларды адам тексеруі қажет.", "Findings require human review.")}</span></div>
      </CardContent></Card> : null}
      {preview ? <SourcePreview key={preview.id} document={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
