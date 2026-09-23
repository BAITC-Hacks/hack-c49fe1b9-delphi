import { Building2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { RefButton } from "@/components/RefButton";
import { StatusChip } from "@/components/StatusChip";
import type { EvidenceRequest, Unit } from "@/types";

interface Props {
  units: Unit[];
  onEvidence(req: EvidenceRequest): void;
}

export function UnitTable({ units, onEvidence }: Props) {
  if (units.length === 0) {
    return <EmptyState icon={Building2} title="Подразделения не выделены" description="В комплекте не найден перечень структурных подразделений." />;
  }

  const open = (u: Unit) =>
    onEvidence({
      title: u.name,
      kind: "unit",
      status: u.status,
      before: u.before ? [u.before] : [],
      after: u.after ? [u.after] : [],
    });

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[280px]">Подразделение</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead className="hidden md:table-cell">Подчинённость</TableHead>
            <TableHead>Источник «До»</TableHead>
            <TableHead>Источник «После»</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {units.map((u, i) => (
            <TableRow
              key={u.unit_id}
              className="animate-in fade-in slide-in-from-bottom-1 duration-150"
              style={{ animationDelay: `${Math.min(i, 12) * 20}ms`, animationFillMode: "both" }}
            >
              <TableCell className="font-medium">
                {u.name}
                {u.note && <p className="mt-0.5 text-xs font-normal text-muted-foreground">{u.note}</p>}
              </TableCell>
              <TableCell>
                <StatusChip status={u.status} kind="unit" />
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{u.parent ?? "—"}</TableCell>
              <TableCell>{u.before ? <RefButton ref_={u.before} onClick={() => open(u)} /> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell>{u.after ? <RefButton ref_={u.after} onClick={() => open(u)} /> : <span className="text-muted-foreground">—</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
