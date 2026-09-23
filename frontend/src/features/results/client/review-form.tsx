"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, HelpCircle, Save, X } from "lucide-react";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage } from "@/shared/api/errors";
import type { FindingResponse, RunDetail } from "@/shared/api/generated";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { resultsApi } from "../api/results-api";
import { reviewLabel, reviewStatuses } from "../model/labels";
import { reviewSchema, type ReviewInput } from "../model/review";

export function ReviewForm({
  finding,
  analysisId,
  disabled = false,
  onReviewSaved,
}: {
  finding: FindingResponse;
  analysisId: string;
  disabled?: boolean;
  onReviewSaved?: (findingId: string) => void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const noteId = useId();
  const form = useForm<ReviewInput>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { status: finding.review.status, note: finding.review.note },
  });
  const mutation = useMutation({
    mutationKey: ["review", finding.run_id],
    mutationFn: (values: ReviewInput) => resultsApi.review(finding.id, values),
    onSuccess: async (review) => {
      form.reset({ status: review.status, note: review.note });
      client.setQueryData<RunDetail>(["run", finding.run_id], (current) =>
        current
          ? {
              ...current,
              resume_available: false,
              review_revision: Math.max(
                current.review_revision,
                review.review_revision,
              ),
            }
          : current,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["findings", finding.run_id] }),
        client.invalidateQueries({ queryKey: ["run", finding.run_id] }),
        client.invalidateQueries({ queryKey: ["analysis", analysisId] }),
        client.invalidateQueries({
          queryKey: ["report", finding.run_id, review.review_revision],
        }),
        client.invalidateQueries({
          queryKey: ["translation", finding.run_id, review.review_revision],
        }),
      ]);
      toast.success(
        t("Проверка сохранена", "Тексеру сақталды", "Review saved"),
      );
      onReviewSaved?.(finding.id);
    },
    onError: (error) => {
      const message = getErrorMessage(error);
      form.setError("root", { message });
      toast.error(message);
    },
  });

  return (
    <form
      className="space-y-4 rounded-lg border bg-muted/20 p-4"
      onSubmit={form.handleSubmit((values) => {
        if (disabled) return;
        form.clearErrors("root");
        mutation.mutate(values);
      })}
    >
      <h4 className="text-sm font-semibold">
        {t("Проверка человеком", "Адамның тексеруі", "Human review")}
      </h4>
      <fieldset className="space-y-2" disabled={disabled || mutation.isPending}>
        <legend className="mb-2 text-xs text-muted-foreground">{t("Решение", "Шешім", "Decision")}</legend>
        <Controller
          control={form.control}
          name="status"
          render={({ field }) => (
            <div className="flex flex-wrap gap-2">
              {reviewStatuses.map((status) => {
                const Icon = { unreviewed: Circle, confirmed: Check, needs_clarification: HelpCircle, rejected: X }[status];
                return <Button type="button" size="sm" variant={field.value === status ? "default" : "outline"} key={status}
                  aria-pressed={field.value === status} disabled={disabled || mutation.isPending}
                  onClick={() => field.onChange(status)}><Icon className="size-3.5" aria-hidden="true" />{reviewLabel(status, t)}</Button>;
              })}
            </div>
          )}
        />
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor={noteId}>{t("Заметка", "Ескертпе", "Note")}</Label>
        <Textarea
          id={noteId}
          rows={3}
          placeholder={t("Что уточнить, у кого или почему вывод отклонён…", "Нені, кімнен нақтылау керек немесе қорытынды неге қабылданбады…", "What to clarify, with whom, or why the finding is rejected…")}
          maxLength={4_000}
          disabled={disabled || mutation.isPending}
          {...form.register("note")}
        />
        {form.formState.errors.note ? (
          <p role="alert" className="text-sm text-destructive">
            {t(
              "Заметка: не более 4000 символов",
              "Ескертпе: 4000 таңбадан аспауы тиіс",
              "Note must contain at most 4,000 characters",
            )}
          </p>
        ) : null}
      </div>
      {form.formState.errors.root ? (
        <p role="alert" className="text-sm text-destructive">
          {form.formState.errors.root.message}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={disabled || mutation.isPending || !form.formState.isDirty}
      >
        <Save className="size-4" aria-hidden="true" />
        {mutation.isPending
          ? t("Сохранение…", "Сақталуда…", "Saving…")
          : t("Сохранить проверку", "Тексеруді сақтау", "Save review")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t(
          "Отметка проверки не изменяет исходный вывод агента.",
          "Тексеру белгісі агенттің бастапқы қорытындысын өзгертпейді.",
          "Your review does not change the agent’s original finding.",
        )}
      </p>
    </form>
  );
}
