import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@bi-rem/db';

export const PERMISSIONS_KEY = 'bi-rem:permissions';
export const ANY_PERMISSION_KEY = 'bi-rem:anyPermission';

/** Requires ALL listed permissions (AND). */
export const Permissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Requires at least ONE of the listed permissions (OR). */
export const AnyPermission = (...permissions: PermissionKey[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);
