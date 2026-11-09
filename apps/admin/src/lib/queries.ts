'use client';

import type { AdminUpdateUserDto, AssignRolesDto } from '@bi-rem/shared/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AuditQueryParams, ListUsersParams } from '@/lib/api';
import { adminApi } from '@/lib/api-browser';
import type {
  AdminCreateUserDto,
  CreateApiKeyDto,
  CreateRoleDto,
  NotificationTemplateUpsertDto,
  StatusReasonDto,
  UpdateRoleDto,
  UpsertFeatureFlagDto,
  UpsertSettingDto,
} from '@/lib/schemas';

/**
 * TanStack Query hooks over the admin API. Query keys are centralised so mutations can
 * invalidate precisely; list queries keep previous data while filters change to avoid flashes.
 */
export const queryKeys = {
  users: {
    all: ['users'] as const,
    list: (params: ListUsersParams) => ['users', 'list', params] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },
  roles: { all: ['roles'] as const },
  permissions: { all: ['permissions'] as const },
  audit: {
    all: ['audit'] as const,
    list: (params: AuditQueryParams) => ['audit', 'list', params] as const,
  },
  featureFlags: { all: ['feature-flags'] as const },
  settings: { all: ['settings'] as const },
  apiKeys: { all: ['api-keys'] as const },
  templates: { all: ['notification-templates'] as const },
};

// --- Users ------------------------------------------------------------------------------------

export function useUsers(params: ListUsersParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.users.list(params),
    queryFn: ({ signal }) => adminApi.users.list(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useUser(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.users.detail(id),
    queryFn: ({ signal }) => adminApi.users.get(id, signal),
    enabled,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: AdminCreateUserDto) => adminApi.users.create(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
  });
}

export function useUpdateUser(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: AdminUpdateUserDto) => adminApi.users.update(id, dto),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.users.detail(id), user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
}

export function useSuspendUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: StatusReasonDto }) =>
      adminApi.users.suspend(id, dto),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.users.detail(user.id), user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
}

export function useReactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: StatusReasonDto }) =>
      adminApi.users.reactivate(id, dto),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.users.detail(user.id), user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
}

export function useAssignRoles(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: AssignRolesDto) => adminApi.users.assignRoles(id, dto),
    // The response is the role set, not the profile: refetch the detail so `roles` is current.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all });
    },
  });
}

// --- RBAC -------------------------------------------------------------------------------------

export function useRoles(enabled = true) {
  return useQuery({
    queryKey: queryKeys.roles.all,
    queryFn: ({ signal }) => adminApi.roles.list(signal),
    enabled,
  });
}

export function usePermissions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.permissions.all,
    queryFn: ({ signal }) => adminApi.permissions.list(signal),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateRoleDto) => adminApi.roles.create(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.roles.all }),
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateRoleDto }) => adminApi.roles.update(id, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.roles.all }),
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.roles.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.roles.all }),
  });
}

// --- Audit ------------------------------------------------------------------------------------

export function useAuditLog(params: AuditQueryParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.audit.list(params),
    queryFn: ({ signal }) => adminApi.audit.list(params, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// --- Feature flags, settings, API keys --------------------------------------------------------

export function useFeatureFlags(enabled = true) {
  return useQuery({
    queryKey: queryKeys.featureFlags.all,
    queryFn: ({ signal }) => adminApi.featureFlags.list(signal),
    enabled,
  });
}

export function useUpsertFeatureFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, dto }: { key: string; dto: UpsertFeatureFlagDto }) =>
      adminApi.featureFlags.upsert(key, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.featureFlags.all }),
  });
}

export function useSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: ({ signal }) => adminApi.settings.list(signal),
    enabled,
  });
}

export function useUpsertSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, dto }: { key: string; dto: UpsertSettingDto }) =>
      adminApi.settings.upsert(key, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.all }),
  });
}

export function useApiKeys(enabled = true) {
  return useQuery({
    queryKey: queryKeys.apiKeys.all,
    queryFn: ({ signal }) => adminApi.apiKeys.list(signal),
    enabled,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateApiKeyDto) => adminApi.apiKeys.create(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all }),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.apiKeys.revoke(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all }),
  });
}

// --- Notification templates -------------------------------------------------------------------

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: queryKeys.templates.all,
    queryFn: ({ signal }) => adminApi.templates.list(signal),
    enabled,
  });
}

export function useUpsertTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: NotificationTemplateUpsertDto) => adminApi.templates.upsert(dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.templates.all }),
  });
}
