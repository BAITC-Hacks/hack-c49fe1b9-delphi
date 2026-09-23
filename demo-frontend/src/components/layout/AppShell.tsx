import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EditionBadge } from "@/components/EditionBadge";
import { ModeBadge } from "@/components/ModeBadge";
import type { EditionInfo, Mode } from "@/types";

interface Props {
  editions?: { before: EditionInfo; after: EditionInfo };
  mode?: Mode;
  failedStage?: number;
  showNew?: boolean;
  children: ReactNode;
}

export function AppShell({ editions, mode, failedStage, showNew = true, children }: Props) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print border-b bg-card">
        <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-3 px-4 md:px-8">
          <Link to="/" className="flex items-baseline gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="text-lg font-semibold tracking-tight">Delphi</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              Контроль функций при реорганизации
            </span>
          </Link>
          <Link to="/" className="hidden text-sm text-muted-foreground hover:text-foreground md:inline">
            История
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto">
            {editions && (
              <>
                <EditionBadge side="before" label={editions.before.label} date={editions.before.date} />
                <EditionBadge side="after" label={editions.after.label} date={editions.after.date} />
              </>
            )}
            <ModeBadge mode={mode} failedStage={failedStage} />
            {showNew && (
              <Button asChild size="sm" variant="outline">
                <Link to="/new">Новое сравнение</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
