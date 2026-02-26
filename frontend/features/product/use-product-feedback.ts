"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { productFeedbackApi } from "@/lib/api/openapi-client";
import type { ProductQuestion, ProductReview } from "@/types/domain";

export const productFeedbackKeys = {
  reviews: (productId: string, limit: number, offset: number) => ["product-feedback", "reviews", productId, limit, offset] as const,
  reviewsPrefix: (productId: string) => ["product-feedback", "reviews", productId] as const,
  questions: (productId: string, limit: number, offset: number) => ["product-feedback", "questions", productId, limit, offset] as const,
  questionsPrefix: (productId: string) => ["product-feedback", "questions", productId] as const
};

export const useProductReviews = (productId: string, params?: { limit?: number; offset?: number }) =>
  useQuery({
    queryKey: productFeedbackKeys.reviews(productId, params?.limit ?? 20, params?.offset ?? 0),
    queryFn: () => productFeedbackApi.listReviews(productId, params),
    enabled: Boolean(productId)
  });

export const useCreateProductReview = (productId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { author: string; rating: number; comment: string; pros?: string; cons?: string }) =>
      productFeedbackApi.createReview(productId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.reviewsPrefix(productId) });
    }
  });
};

export const useProductQuestions = (productId: string, params?: { limit?: number; offset?: number }) =>
  useQuery({
    queryKey: productFeedbackKeys.questions(productId, params?.limit ?? 20, params?.offset ?? 0),
    queryFn: () => productFeedbackApi.listQuestions(productId, params),
    enabled: Boolean(productId)
  });

export const useCreateProductQuestion = (productId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { author: string; question: string }) => productFeedbackApi.createQuestion(productId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.questionsPrefix(productId) });
    }
  });
};

export const useCreateQuestionAnswer = (productId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { questionId: string; text: string; is_official?: boolean }) =>
      productFeedbackApi.createAnswer(payload.questionId, {
        text: payload.text,
        is_official: payload.is_official
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.questionsPrefix(productId) });
    }
  });
};

export const useVoteProductReview = (productId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { reviewId: string; helpful: boolean }) =>
      productFeedbackApi.voteReview(payload.reviewId, { helpful: payload.helpful }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: productFeedbackKeys.reviewsPrefix(productId) });
      const snapshots = queryClient.getQueriesData<ProductReview[]>({ queryKey: productFeedbackKeys.reviewsPrefix(productId) });
      for (const [key, reviews] of snapshots) {
        if (!reviews) continue;
        queryClient.setQueryData<ProductReview[]>(key, reviews.map((review) => {
          if (review.id !== payload.reviewId) return review;
          return {
            ...review,
            helpful_votes: (review.helpful_votes ?? 0) + (payload.helpful ? 1 : 0),
            not_helpful_votes: (review.not_helpful_votes ?? 0) + (payload.helpful ? 0 : 1)
          };
        }));
      }
      return { snapshots };
    },
    onError: (_error, _payload, context) => {
      if (!context?.snapshots) return;
      for (const [key, reviews] of context.snapshots) {
        queryClient.setQueryData(key, reviews);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.reviewsPrefix(productId) });
    }
  });
};

export const useReportProductReview = (productId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { reviewId: string; reason: string }) =>
      productFeedbackApi.reportReview(payload.reviewId, { reason: payload.reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.reviewsPrefix(productId) });
    }
  });
};

export const useReportProductQuestion = (productId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { questionId: string; reason: string }) =>
      productFeedbackApi.reportQuestion(payload.questionId, { reason: payload.reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.questionsPrefix(productId) });
    }
  });
};

export const usePinProductAnswer = (productId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { answerId: string; pinned: boolean }) =>
      productFeedbackApi.pinAnswer(payload.answerId, { pinned: payload.pinned }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: productFeedbackKeys.questionsPrefix(productId) });
      const snapshots = queryClient.getQueriesData<ProductQuestion[]>({ queryKey: productFeedbackKeys.questionsPrefix(productId) });
      for (const [key, questions] of snapshots) {
        if (!questions) continue;
        queryClient.setQueryData<ProductQuestion[]>(key, questions.map((question) => ({
          ...question,
          answers: question.answers.map((answer) => (answer.id === payload.answerId ? { ...answer, is_pinned: payload.pinned } : answer))
        })));
      }
      return { snapshots };
    },
    onError: (_error, _payload, context) => {
      if (!context?.snapshots) return;
      for (const [key, questions] of context.snapshots) {
        queryClient.setQueryData(key, questions);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.questionsPrefix(productId) });
    }
  });
};
