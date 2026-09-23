import { ArrowRightLeft } from "lucide-react";

/** The landing illustrates the verified transfer control example. */
export function StatusChip({ status, size = "sm" }: { status: "transferred"; size?: "sm" | "md" }) {
  return (
    <span className={`status-chip status-chip--${size}`} data-status={status} title="Функция найдена у другого исполнителя или в другом документе.">
      <ArrowRightLeft aria-hidden="true" />Передана
    </span>
  );
}
