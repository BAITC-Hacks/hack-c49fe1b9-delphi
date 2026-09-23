import { FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { citeRef } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClauseRef } from "@/types";

interface Props {
  ref_: ClauseRef;
  onClick(): void;
  className?: string;
  size?: "sm" | "xs";
}

/** "ред. 9, п. 5.3.3" — click opens the evidence drawer. */
export function RefButton({ ref_, onClick, className, size = "sm" }: Props) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn("h-7 gap-1 px-2 font-mono text-xs font-normal", size === "xs" && "h-6 px-1.5", className)}
      aria-label={`Открыть источник: ${citeRef(ref_)}`}
    >
      <FileSearch className="size-3.5 text-muted-foreground" aria-hidden="true" />
      {citeRef(ref_)}
    </Button>
  );
}
