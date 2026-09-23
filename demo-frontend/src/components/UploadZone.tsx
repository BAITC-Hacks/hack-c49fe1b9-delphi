import { useId, useRef, useState, type DragEvent } from "react";
import { FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = [".docx", ".pdf", ".md", ".xlsx", ".txt"];

interface Props {
  side: "before" | "after";
  files: File[];
  onFiles(files: File[]): void;
  onRemove(index: number): void;
  disabled?: boolean;
}

function detectEdition(name: string): string | null {
  const m = name.match(/редакци[яи][_\s-]*(?:no|№)?\s*(\d+)/i) ?? name.match(/ред\.?\s*(\d+)/i);
  return m ? `ред. ${m[1]}` : null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function UploadZone({ side, files, onFiles, onRemove, disabled }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (list: FileList | null) => {
    if (!list) return;
    const ok: File[] = [];
    const bad: string[] = [];
    Array.from(list).forEach((f) => {
      const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      if (ACCEPT.includes(ext)) ok.push(f);
      else bad.push(f.name);
    });
    if (bad.length) toast.error(`Формат не поддерживается: ${bad.join(", ")}`);
    if (ok.length) onFiles(ok);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    accept(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-label={side === "before" ? "Загрузить комплект «До»" : "Загрузить комплект «После»"}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-card p-6 text-center transition-colors duration-150",
          "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">{side === "before" ? "Комплект «До»" : "Комплект «После»"}</p>
        <p className="text-xs text-muted-foreground">
          Перетащите файлы или нажмите. DOCX, PDF с текстом, MD, XLSX
        </p>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT.join(",")}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => {
            const edition = detectEdition(f.name);
            return (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={f.name}>
                  {f.name}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{formatSize(f.size)}</span>
                {edition && (
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs">Определено: {edition}</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label={`Удалить ${f.name}`}
                  onClick={() => onRemove(i)}
                  disabled={disabled}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
