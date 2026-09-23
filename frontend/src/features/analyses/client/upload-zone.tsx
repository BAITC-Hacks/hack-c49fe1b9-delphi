"use client";

import { Loader2, Upload } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { supportedDocumentTypes } from "@/features/analyses/model";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/lib/utils";

export function UploadZone({
  side,
  disabled,
  progress,
  onFiles,
}: {
  side: "before" | "after";
  disabled: boolean;
  progress?: string;
  onFiles: (files: File[]) => void;
}) {
  const { t } = useI18n();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const label = side === "before"
    ? t("Загрузить комплект «До»", "«Дейін» жиынтығын жүктеу", "Upload Before documents")
    : t("Загрузить комплект «После»", "«Кейін» жиынтығын жүктеу", "Upload After documents");

  function accept(files: FileList | null) {
    if (!disabled && files?.length) onFiles(Array.from(files));
  }

  function enter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth.current += 1;
    if (!disabled) setDragging(true);
  }

  return (
    <div
      onDragEnter={enter}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        accept(event.dataTransfer.files);
      }}
      className={cn(
        "rounded-lg border-2 border-dashed bg-card transition-colors",
        dragging && !disabled ? "border-primary bg-primary/5" : "border-border",
        disabled && !progress && "opacity-60",
      )}
    >
      <button
        type="button"
        aria-label={label}
        aria-controls={inputId}
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="flex min-h-44 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-lg px-5 py-7 text-center outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-primary">
          {progress ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Upload className="size-5" aria-hidden="true" />}
        </span>
        <span className="space-y-1">
          <span className="block text-sm font-medium">
            {dragging && !disabled
              ? t("Отпустите файлы для загрузки", "Жүктеу үшін файлдарды жіберіңіз", "Drop files to upload")
              : t("Перетащите файлы или выберите", "Файлдарды сүйреңіз немесе таңдаңыз", "Drop files here or browse")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("DOCX, PDF с текстом, XLSX, Markdown", "DOCX, мәтіндік PDF, XLSX, Markdown", "DOCX, text PDF, XLSX, Markdown")}
          </span>
        </span>
      </button>
      <input
        id={inputId}
        ref={input}
        type="file"
        className="hidden"
        aria-label={label}
        multiple
        accept={supportedDocumentTypes}
        disabled={disabled}
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = "";
        }}
      />
      {progress ? <p role="status" className="border-t border-dashed px-4 py-3 text-center text-xs text-muted-foreground [overflow-wrap:anywhere]">{t("Загрузка и чтение", "Жүктеу және оқу", "Uploading and parsing")} · {progress}</p> : null}
    </div>
  );
}
