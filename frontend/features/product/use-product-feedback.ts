"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { productFeedbackApi } from "@/lib/api/openapi-client";

export const productFeedbackKeys = {
  reviews: (productId: string) => ["product-feedback", "reviews", productId] as const,
  questions: (productId: string) => ["product-feedback", "questions", productId] as const
};

export const useProductReviews = (productId: string) =>
  useQuery({
    queryKey: productFeedbackKeys.reviews(productId),
    queryFn: () => productFeedbackApi.listReviews(productId),
    enabled: Boolean(productId)
  });

export const useCreateProductReview = (productId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { author: string; rating: number; comment: string; pros?: string; cons?: string }) =>
      productFeedbackApi.createReview(productId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.reviews(productId) });
    }
  });
};

export const useProductQuestions = (productId: string) =>
  useQuery({
    queryKey: productFeedbackKeys.questions(productId),
    queryFn: () => productFeedbackApi.listQuestions(productId),
    enabled: Boolean(productId)
  });

export const useCreateProductQuestion = (productId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { author: string; question: string }) => productFeedbackApi.createQuestion(productId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.questions(productId) });
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
      await queryClient.invalidateQueries({ queryKey: productFeedbackKeys.questions(productId) });
    }
  });
};
