import { useEffect, useState } from "react";
import { Check, CircleHelp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { REVIEW_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Review, ReviewStatus } from "@/types";

export function ReviewChip({ review, className }: { review?: Review; className?: string }) {
  if (!review || review.status === "unreviewed") return null;
  const meta = REVIEW_STATUS[review.status];
  const Icon = meta.icon;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", meta.className, className)}
      title={review.note || undefined}
    >
      <Icon className="size-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

interface Props {
  findingId: string;
  review?: Review;
  onSave(findingId: string, status: ReviewStatus, note: string): Promise<void>;
}

const ACTIONS: { status: ReviewStatus; label: string; icon: typeof Check }[] = [
  { status: "confirmed", label: "Подтвердить", icon: Check },
  { status: "needs_clarification", label: "Вопрос", icon: CircleHelp },
  { status: "rejected", label: "Отклонить", icon: X },
];

/** Scenario H: the analyst confirms, questions or rejects an AI finding; saved on the server with a note. */
export function ReviewControls({ findingId, review, onSave }: Props) {
  const [saved, setSaved] = useState<Review>(review ?? { status: "unreviewed" });
  const [note, setNote] = useState(review?.note ?? "");
  const [saving, setSaving] = useState<ReviewStatus | null>(null);

  useEffect(() => {
    setSaved(review ?? { status: "unreviewed" });
    setNote(review?.note ?? "");
    // reset only when another finding is opened; after a save local state is the truth
  }, [findingId]);

  const save = async (status: ReviewStatus) => {
    setSaving(status);
    try {
      await onSave(findingId, status, note);
      setSaved({ status, note: note || undefined });
      toast.success(status === "unreviewed" ? "Отметка снята" : `Сохранено: ${REVIEW_STATUS[status].label.toLowerCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить проверку");
    } finally {
      setSaving(null);
    }
  };

  const noteDirty = note !== (saved.note ?? "");

  return (
    <section className="flex flex-col gap-3 border-t bg-muted/30 px-5 py-4" aria-label="Проверка человеком">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Проверка человеком</h3>
        <ReviewChip review={saved} />
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={4000}
        rows={2}
        placeholder="Заметка для заключения: что уточнить, у кого, почему отклонено (необязательно)"
        className="min-h-14 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Заметка проверяющего"
      />
      <div className="flex flex-wrap items-center gap-2">
        {ACTIONS.map(({ status, label, icon: Icon }) => (
          <Button
            key={status}
            size="sm"
            variant={saved.status === status ? "default" : "outline"}
            aria-pressed={saved.status === status}
            disabled={saving !== null}
            onClick={() => save(status)}
            className="gap-1.5"
          >
            {saving === status ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Icon className="size-3.5" aria-hidden="true" />}
            {label}
          </Button>
        ))}
        {saved.status !== "unreviewed" && noteDirty && (
          <Button size="sm" variant="secondary" disabled={saving !== null} onClick={() => save(saved.status)}>
            Сохранить заметку
          </Button>
        )}
        {saved.status !== "unreviewed" && !noteDirty && (
          <Button size="sm" variant="ghost" disabled={saving !== null} onClick={() => save("unreviewed")}>
            Снять отметку
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Отметка сохраняется на сервере и попадает в заключение и экспорт. Сам вывод ИИ не меняется.
      </p>
    </section>
  );
}
