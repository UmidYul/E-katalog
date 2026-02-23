"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi } from "@/lib/api/openapi-client";
import type { AdminUser } from "@/types/admin";
import type { Paginated } from "@/types/domain";

const fallbackUsers: Paginated<AdminUser> = { items: [], next_cursor: null, request_id: "admin-fallback" };

export function useUsers(query: { q?: string; page?: number; limit?: number; sort?: string }) {
  return useQuery({
    queryKey: ["admin", "users", query],
    queryFn: async () => {
      try {
        const { data } = await adminApi.users(query);
        return data;
      } catch {
        return fallbackUsers;
      }
    },
  });
}

export function useUserById(id: string) {
  return useQuery({
    queryKey: ["admin", "user", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await adminApi.userById(id);
      return data;
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<AdminUser> }) => adminApi.updateUser(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}
