"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Eye, FileText, Loader2, Save, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { confirm } from "@/components/custom-ui/confirm-nice-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { editDocument, removeDocument } from "@/features/analyses/api/analyses";
import { revisionSchema, warningDescription, type RevisionValues } from "@/features/analyses/model";
import { getErrorMessage } from "@/shared/api/errors";
import type { DocumentResponse, PatchDocument } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";

export function DocumentCard({ document, locked, busy, onPreview }: { document: DocumentResponse; locked: boolean; busy: boolean; onPreview: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const form = useForm<RevisionValues>({ resolver: zodResolver(revisionSchema), defaultValues: { revision: document.revision_label ?? "" } });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["analysis", document.analysis_id] });
  const patch = useMutation({
    mutationKey: ["documents", document.analysis_id],
    mutationFn: (body: PatchDocument) => editDocument(document.analysis_id, document.id, body),
    onSuccess: () => { refresh(); toast.success(t("Документ обновлён", "Құжат жаңартылды", "Document updated")); },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const remove = useMutation({
    mutationKey: ["documents", document.analysis_id],
    mutationFn: () => removeDocument(document.analysis_id, document.id),
    onSuccess: () => { refresh(); toast.success(t("Документ удалён из черновика", "Құжат нобайдан жойылды", "Document removed from draft")); },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const pending = patch.isPending || remove.isPending;
  const statusLabels = {
    pending: t("Ожидает чтения", "Оқуды күтуде", "Awaiting parsing"),
    parsed: t("Прочитан", "Оқылды", "Parsed"),
    partial: t("Есть ограничения", "Шектеулер бар", "Has limitations"),
    failed: t("Ошибка чтения", "Оқу қатесі", "Parsing failed"),
  };

  async function deleteFile() {
    if (await confirm({
      title: t("Удалить документ?", "Құжатты жою керек пе?", "Remove document?"),
      description: document.filename,
      confirmLabel: t("Удалить", "Жою", "Remove"),
      cancelLabel: t("Отмена", "Бас тарту", "Cancel"),
      destructive: true,
    })) remove.mutate();
  }

  return (
    <article className="min-w-0 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><FileText className="size-4 text-primary" aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium leading-relaxed [overflow-wrap:anywhere]">{document.filename}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{document.format.toUpperCase()} · {document.block_count} {t("текстовых блоков", "мәтіндік блок", "text blocks")}{document.detected_language ? ` · ${document.detected_language.toUpperCase()}` : ""}</p>
        </div>
      </div>
      <Badge variant={document.parse_status === "failed" ? "destructive" : "outline"} className={`mt-3 gap-1.5 font-normal ${document.parse_status === "partial" ? "border-status-missing-fg/20 bg-status-missing-bg text-status-missing-fg" : document.parse_status === "parsed" ? "border-status-new-fg/20 bg-status-new-bg text-status-new-fg" : ""}`}>{document.parse_status === "parsed" ? <CheckCircle2 className="size-3" aria-hidden="true" /> : document.parse_status === "partial" || document.parse_status === "failed" ? <AlertTriangle className="size-3" aria-hidden="true" /> : <Loader2 className="size-3 animate-spin" aria-hidden="true" />}{statusLabels[document.parse_status]}</Badge>
      <form className="mt-4 space-y-2" onSubmit={form.handleSubmit(({ revision }) => patch.mutate({ revision_label: revision || null }))}>
        <Label htmlFor={`revision-${document.id}`} className="text-xs">{t("Подпись редакции", "Редакция белгісі", "Revision label")}</Label>
        <div className="flex gap-2">
          <Input id={`revision-${document.id}`} maxLength={100} disabled={locked || busy || pending} {...form.register("revision")} placeholder={t("Например, редакция 8", "Мысалы, 8-редакция", "For example, revision 8")} />
          {!locked ? <Button variant="outline" size="icon" type="submit" disabled={!form.formState.isDirty || busy || pending} aria-label={t("Сохранить подпись", "Белгіні сақтау", "Save revision label")}><Save className="size-4" aria-hidden="true" /></Button> : null}
        </div>
        {form.formState.errors.revision ? <p className="text-xs text-destructive">{t("Не более 100 символов", "100 таңбадан аспауы керек", "Use 100 characters or fewer")}</p> : null}
      </form>
      {document.warnings.length ? <details className="mt-3 text-xs" open={document.parse_status === "partial"}><summary className="cursor-pointer font-medium">{t("Предупреждения", "Ескертулер", "Parsing notes")} ({document.warnings.length})</summary><ul className="mt-2 space-y-1 pl-4 text-muted-foreground">{document.warnings.map((warning, index) => <li className="list-disc break-words" key={`${warning}-${index}`}>{warningDescription(warning, t)}</li>)}</ul></details> : null}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t pt-3">
        <Button variant="outline" size="sm" onClick={onPreview} disabled={!document.block_count}><Eye className="size-4" aria-hidden="true" />{t("Текст", "Мәтін", "Preview")}</Button>
        {!locked ? <><Button variant="ghost" size="sm" disabled={busy || pending} onClick={() => patch.mutate({ side: document.side === "before" ? "after" : "before" })}><ArrowLeftRight className="size-4" aria-hidden="true" />{document.side === "before" ? t("В «После»", "«Кейінге»", "Move to After") : t("В «До»", "«Дейінге»", "Move to Before")}</Button><Button variant="ghost" size="icon" className="ml-auto size-8 text-muted-foreground hover:text-destructive" disabled={busy || pending} onClick={deleteFile} aria-label={t("Удалить документ", "Құжатты жою", "Remove document")}>{remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" aria-hidden="true" />}</Button></> : null}
      </div>
      {patch.isError || remove.isError ? <p role="alert" className="mt-2 text-xs text-destructive">{getErrorMessage(patch.error ?? remove.error)}</p> : null}
    </article>
  );
}
