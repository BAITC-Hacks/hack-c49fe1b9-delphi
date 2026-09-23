"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
}: {
  finding: FindingResponse;
  analysisId: string;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const form = useForm<ReviewInput>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { status: finding.review.status, note: finding.review.note },
  });
  const mutation = useMutation({
    mutationFn: (values: ReviewInput) => resultsApi.review(finding.id, values),
    onSuccess: async (review) => {
      form.reset({ status: review.status, note: review.note });
      client.setQueryData<RunDetail>(["run", finding.run_id], (current) =>
        current
          ? {
              ...current,
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
    },
    onError: (error) => {
      const message = getErrorMessage(error);
      form.setError("root", { message });
      toast.error(message);
    },
  });

  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={form.handleSubmit((values) => {
        form.clearErrors("root");
        mutation.mutate(values);
      })}
    >
      <h4 className="text-sm font-semibold">
        {t("Проверка человеком", "Адамның тексеруі", "Human review")}
      </h4>
      <div className="space-y-2">
        <Label htmlFor="review-status">
          {t("Решение", "Шешім", "Decision")}
        </Label>
        <Controller
          control={form.control}
          name="status"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={mutation.isPending}
            >
              <SelectTrigger id="review-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reviewStatuses.map((status) => (
                  <SelectItem value={status} key={status}>
                    {reviewLabel(status, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="review-note">{t("Заметка", "Ескертпе", "Note")}</Label>
        <Textarea
          id="review-note"
          rows={4}
          maxLength={4_000}
          disabled={mutation.isPending}
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
        disabled={mutation.isPending || !form.formState.isDirty}
      >
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
