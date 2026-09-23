import { Download, FileSpreadsheet, FileText, Printer, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { functionsCsvUrl, reportUrl } from "@/lib/api";
import { buildCsv, buildHtml, download } from "@/lib/export";
import type { AnalysisResult } from "@/types";

/** Prints the whole report (all tabs), not the currently visible tab. Falls back to window.print if pop-ups are blocked. */
function printReport(result: AnalysisResult) {
  const w = window.open("", "_blank", "noopener");
  if (!w) {
    window.print();
    return;
  }
  w.document.open();
  w.document.write(buildHtml(result));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function ExportMenu({ result }: { result: AnalysisResult }) {
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Download className="size-4" aria-hidden="true" />
          Экспорт
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => download(`delphi-zaklyuchenie-${stamp}.html`, buildHtml(result), "text/html;charset=utf-8")}>
          <FileText className="size-4" aria-hidden="true" />
          Скачать HTML
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => printReport(result)}>
          <Printer className="size-4" aria-hidden="true" />
          Печать / PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => download(`delphi-funkcii-${stamp}.csv`, buildCsv(result), "text/csv;charset=utf-8")}>
          <FileSpreadsheet className="size-4" aria-hidden="true" />
          CSV функций
        </DropdownMenuItem>
        {result.live && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={reportUrl(result.live.run_id)} target="_blank" rel="noopener">
                <Server className="size-4" aria-hidden="true" />
                Отчёт сервера (HTML)
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={functionsCsvUrl(result.live.run_id)} download>
                <Server className="size-4" aria-hidden="true" />
                CSV сервера
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
