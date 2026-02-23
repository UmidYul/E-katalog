"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { type UserProfilePatch, userApi } from "@/lib/api/openapi-client";

export const useUserProfile = () =>
  useQuery({
    queryKey: ["user", "profile"],
    queryFn: async () => {
      const { data } = await userApi.profile();
      return data;
    }
  });

export const useUpdateUserProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UserProfilePatch) => {
      const { data } = await userApi.updateProfile(payload);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["user", "profile"] });
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  });
};
