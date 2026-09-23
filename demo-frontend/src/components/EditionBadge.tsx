import { Badge } from "@/components/ui/badge";

interface Props {
  side: "before" | "after";
  label: string;
  date?: string;
}

export function EditionBadge({ side, label, date }: Props) {
  return (
    <Badge variant="outline" className="gap-1 whitespace-nowrap font-normal">
      <span className="text-muted-foreground">{side === "before" ? "До:" : "После:"}</span>
      <span>{label}</span>
      {date && <span className="text-muted-foreground">· {date}</span>}
    </Badge>
  );
}
