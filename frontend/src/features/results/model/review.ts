import { z } from "zod";

export const reviewSchema = z.object({
  status: z.enum([
    "unreviewed",
    "confirmed",
    "needs_clarification",
    "rejected",
  ]),
  note: z.string().max(4_000),
});

export type ReviewInput = z.infer<typeof reviewSchema>;
