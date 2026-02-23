"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";

export type AdminFeedbackQueueQuery = {
  status?: "all" | "published" | "pending" | "rejected";
  kind?: "all" | "review" | "question";
  limit?: number;
  offset?: number;
};

export const adminFeedbackKeys = {
  all: ["admin", "feedback"] as const,
  queue: (query: AdminFeedbackQueueQuery) => ["admin", "feedback", "queue", query] as const,
};

export function useAdminFeedbackQueue(query: AdminFeedbackQueueQuery) {
  return useQuery({
    queryKey: adminFeedbackKeys.queue(query),
    queryFn: async () => (await adminApi.feedbackQueue(query)).data,
  });
}

export function useModerateFeedbackItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { kind: "review" | "question"; id: string; status: "published" | "pending" | "rejected" }) => {
      if (payload.kind === "review") {
        const { data } = await adminApi.moderateReview(payload.id, { status: payload.status });
        return data;
      }
      const { data } = await adminApi.moderateQuestion(payload.id, { status: payload.status });
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminFeedbackKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["product-feedback"] }),
      ]);
    },
  });
}

