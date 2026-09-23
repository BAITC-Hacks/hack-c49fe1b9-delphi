"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileUp, Loader2, Play } from "lucide-react";
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
import { comparisonSchema, supportedDocumentTypes, type ComparisonValues } from "@/features/analyses/model";
import { getErrorMessage } from "@/shared/api/errors";
import type { DocumentResponse, StartRun } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { DocumentCard } from "./document-card";
import { SourcePreview } from "./source-preview";

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
    <div className="max-w-2xl space-y-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("Новое сравнение", "Жаңа салыстыру", "New comparison")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("Сначала задайте название. Затем загрузите документы до и после реорганизации.", "Алдымен атау беріңіз. Содан кейін қайта ұйымдастыруға дейінгі және кейінгі құжаттарды жүктеңіз.", "Name the comparison, then upload documents from before and after the reorganisation.")}</p></div>
      <Card><CardHeader><CardTitle>{t("Сохранить черновик", "Нобайды сақтау", "Create a draft")}</CardTitle><CardDescription>{t("Черновик и загруженные документы сохраняются в истории.", "Нобай мен жүктелген құжаттар тарихта сақталады.", "Your draft and uploaded documents are saved in history.")}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <div className="space-y-2"><Label htmlFor="comparison-title">{t("Название сравнения", "Салыстыру атауы", "Comparison title")}</Label><Input id="comparison-title" autoFocus maxLength={200} disabled={create.isPending} aria-invalid={Boolean(form.formState.errors.title)} {...form.register("title")} placeholder={t("Например, БВА: редакция 8 → 9", "Мысалы, ІАБ: 8 → 9-редакция", "For example, Internal audit: revision 8 → 9")} />{form.formState.errors.title ? <p className="text-sm text-destructive">{t("Введите название от 1 до 200 символов", "1–200 таңбадан тұратын атау енгізіңіз", "Enter a title between 1 and 200 characters")}</p> : null}</div>
        {form.formState.errors.root ? <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
        <Button type="submit" disabled={create.isPending}>{create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}{t("К загрузке документов", "Құжаттарды жүктеуге өту", "Continue to documents")}</Button>
      </form></CardContent></Card>
      <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">{t("Открыть сохранённые сравнения и примеры", "Сақталған салыстырулар мен мысалдарды ашу", "Open saved comparisons and examples")}</Link>
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{analysis.data.title}</h1><p className="mt-2 text-sm text-muted-foreground">{t("Документы сохраняются после загрузки. Проверьте стороны, подписи редакций и предупреждения.", "Құжаттар жүктелгеннен кейін сақталады. Жақтарын, редакция белгілерін және ескертулерді тексеріңіз.", "Documents are saved after upload. Check the sides, revision labels, and parsing notes.")}</p></div><StatusBadge status={analysis.data.run?.state ?? "draft"} /></div>
      {locked ? <Alert><AlertTitle>{t("Документы этого запуска зафиксированы", "Осы іске қосудың құжаттары бекітілген", "This run's documents are locked")}</AlertTitle><AlertDescription>{t("Для изменения входных документов создайте повтор из истории.", "Кіріс құжаттарын өзгерту үшін тарихтан қайталау жасаңыз.", "Use Repeat in history to change the input documents.")}<Link className={buttonVariants({ size: "sm" })} href={`/analyses/${analysisId}`}>{t("Открыть результат", "Нәтижені ашу", "Open result")}</Link></AlertDescription></Alert> : null}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {(["before", "after"] as const).map((side) => <Card key={side}><CardHeader><CardTitle className="flex items-center gap-2"><FileUp className="size-5" aria-hidden="true" />{side === "before" ? t("До реорганизации", "Қайта ұйымдастыруға дейін", "Before reorganisation") : t("После реорганизации", "Қайта ұйымдастырудан кейін", "After reorganisation")}</CardTitle><CardDescription>{t("DOCX, текстовый PDF, XLSX, Markdown. Можно выбрать несколько файлов.", "DOCX, мәтіндік PDF, XLSX, Markdown. Бірнеше файлды таңдауға болады.", "DOCX, text PDF, XLSX, Markdown. Select multiple files at once.")}</CardDescription></CardHeader><CardContent className="space-y-4">
          {!locked ? <div className="space-y-2 rounded-lg border border-dashed p-4"><Label htmlFor={`upload-${side}`}>{t("Добавить документы", "Құжаттарды қосу", "Add documents")}</Label><Input id={`upload-${side}`} type="file" accept={supportedDocumentTypes} multiple disabled={busy} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) upload.mutate({ side, files }); }} />{upload.isPending && upload.variables?.side === side ? <p role="status" className="flex items-center gap-2 break-all text-xs text-muted-foreground"><Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />{uploadProgress}</p> : null}</div> : null}
          {documents.filter((document) => document.side === side).map((document) => <DocumentCard key={`${document.id}:${document.revision_label}`} document={document} locked={locked} busy={busy} onPreview={() => setPreview(document)} />)}
          {!documents.some((document) => document.side === side) ? <p className="py-4 text-center text-sm text-muted-foreground">{t("Документы пока не добавлены", "Құжаттар әлі қосылмаған", "No documents added yet")}</p> : null}
        </CardContent></Card>)}
      </div>
      {uploadErrors.length ? <Alert variant="destructive"><AlertTitle>{t("Часть файлов не сохранена", "Кейбір файлдар сақталмады", "Some files were not saved")}</AlertTitle><AlertDescription><p>{t("Загрузите исправленные файлы повторно или явно исключите их из выбранного комплекта перед запуском.", "Іске қоспас бұрын түзетілген файлдарды қайта жүктеңіз немесе оларды таңдалған жиынтықтан алып тастаңыз.", "Retry the corrected files or explicitly exclude them from the selected set before starting.")}</p><ul className="w-full space-y-2">{uploadErrors.map((error, index) => <li key={`${error.filename}-${index}`} className="flex flex-wrap items-center justify-between gap-2 break-words"><span><strong>{error.filename}</strong>: {error.message}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => setUploadErrors((previous) => previous.filter((_, position) => position !== index))}>{t("Исключить файл", "Файлды алып тастау", "Exclude file")}</Button></li>)}</ul></AlertDescription></Alert> : null}
      {!locked ? <Card><CardHeader><CardTitle>{t("Настройки анализа", "Талдау параметрлері", "Analysis options")}</CardTitle><CardDescription>{t("Проверяем подразделения, обязанности и вопросы со ссылками на исходные пункты. Выводы требуют проверки человеком.", "Бөлімшелерді, міндеттерді және мәселелерді бастапқы тармақтарға сілтемелермен тексереміз. Қорытындыларды адам тексеруі қажет.", "Compare teams, duties, and potential issues with original sources. Findings require human review.")}</CardDescription></CardHeader><CardContent className="space-y-5">
        <div className="max-w-xs space-y-2"><Label htmlFor="output-language">{t("Язык пояснений", "Түсіндірмелер тілі", "Explanation language")}</Label><Select value={outputLanguage} onValueChange={(value) => setOutputLanguage(value as StartRun["output_language"])} disabled={busy}><SelectTrigger id="output-language"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ru">Русский</SelectItem><SelectItem value="kk">Қазақша</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{t("Цитаты останутся на языке оригинала.", "Дәйексөздер түпнұсқа тілінде қалады.", "Source quotations stay in their original language.")}</p></div>
        {hasPartial ? <Alert><AlertTitle>{t("В документах есть ограничения чтения", "Құжаттарды оқуда шектеулер бар", "The documents have parsing limitations")}</AlertTitle><AlertDescription><p>{t("Изучите предупреждения выше. Непрочитанные части не войдут в проверку.", "Жоғарыдағы ескертулерді қарап шығыңыз. Оқылмаған бөліктер тексеруге кірмейді.", "Read the notes above. Unreadable content will not be included in the comparison.")}</p><div className="mt-3 flex items-start gap-3"><Checkbox id="allow-partial" checked={allowPartial} onCheckedChange={(checked) => setAllowPartial(checked === true)} disabled={busy} /><Label htmlFor="allow-partial" className="leading-normal">{t("Я ознакомился с ограничениями и разрешаю частичный анализ", "Шектеулермен таныстым және ішінара талдауға рұқсат беремін", "I reviewed the limitations and allow a partial analysis")}</Label></div></AlertDescription></Alert> : null}
        {!hasBothSides ? <p className="text-sm text-muted-foreground">{t("Добавьте хотя бы один документ на каждую сторону.", "Әр жаққа кемінде бір құжат қосыңыз.", "Add at least one document on each side.")}</p> : null}
        {!allReadable ? <p role="alert" className="text-sm text-destructive">{t("Удалите или замените непрочитанные документы перед запуском.", "Іске қоспас бұрын оқылмаған құжаттарды жойыңыз немесе ауыстырыңыз.", "Remove or replace documents without readable text before starting.")}</p> : null}
        {start.isError ? <Alert variant="destructive"><AlertDescription>{getErrorMessage(start.error)}</AlertDescription></Alert> : null}
        <Button disabled={!ready} onClick={() => start.mutate({ output_language: outputLanguage, allow_partial: hasPartial && allowPartial })}>{start.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}{t("Начать анализ", "Талдауды бастау", "Start analysis")}</Button>
      </CardContent></Card> : null}
      {preview ? <SourcePreview key={preview.id} document={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
