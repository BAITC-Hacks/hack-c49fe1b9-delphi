import { useEffect, useState } from "react";
import { Check, CircleHelp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Review, ReviewStatus } from "@/types";

const ACTIONS: { status: ReviewStatus; label: string; key: string; icon: typeof Check }[] = [
  { status: "confirmed", label: "Подтвердить", key: "1", icon: Check },
  { status: "needs_clarification", label: "Вопрос", key: "2", icon: CircleHelp },
  { status: "rejected", label: "Отклонить", key: "3", icon: X },
];

interface Props {
  itemId: string;
  review: Review;
  /** Offline example: decisions stay in this browser only. */
  localOnly: boolean;
  onDecide(status: ReviewStatus, note: string): Promise<void>;
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable);

/** Bottom bar: the human decision. Keys 1/2/3 decide, Ctrl/⌘+Enter in the note saves with the current status. */
export function DecisionBar({ itemId, review, localOnly, onDecide }: Props) {
  const [note, setNote] = useState(review.note ?? "");
  const [saving, setSaving] = useState<ReviewStatus | null>(null);

  useEffect(() => setNote(review.note ?? ""), [itemId, review.note]);

  const decide = async (status: ReviewStatus) => {
    if (saving) return;
    setSaving(status);
    try {
      await onDecide(status, note);
    } finally {
      setSaving(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const action = ACTIONS.find((a) => a.key === e.key);
      if (action) {
        e.preventDefault();
        void decide(action.status);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80" aria-label="Решение проверяющего">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void decide(review.status === "unreviewed" ? "needs_clarification" : review.status);
          }
        }}
        maxLength={4000}
        rows={1}
        placeholder="Заметка: что уточнить, у кого, почему отклонено (необязательно)"
        className="min-h-9 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Заметка проверяющего"
      />
      <div className="flex flex-wrap items-center gap-2">
        {ACTIONS.map(({ status, label, key, icon: Icon }) => (
          <Button
            key={status}
            size="sm"
            variant={review.status === status ? "default" : "outline"}
            aria-pressed={review.status === status}
            disabled={saving !== null}
            onClick={() => decide(status)}
            className="gap-1.5"
          >
            {saving === status ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Icon className="size-3.5" aria-hidden="true" />}
            {label}
            <kbd className="ml-0.5 hidden rounded border px-1 font-mono text-[10px] leading-4 text-muted-foreground sm:inline">{key}</kbd>
          </Button>
        ))}
        <p className="ml-auto text-xs text-muted-foreground">
          {localOnly ? "Пример: решения сохраняются в этом браузере. " : ""}После решения откроется следующий вопрос · J / K — вниз / вверх
        </p>
      </div>
    </div>
  );
}
