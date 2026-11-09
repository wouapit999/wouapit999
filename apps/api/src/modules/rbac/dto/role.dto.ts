import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PERMISSION_KEYS, type PermissionKey } from '@bi-rem/db';

export class CreateRoleDto {
  /** UPPER_SNAKE_CASE identifier, e.g. `SUPPORT_LEAD`. */
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { message: 'name must be UPPER_SNAKE_CASE (2-50 chars)' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(PERMISSION_KEYS.length)
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions: PermissionKey[] = [];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, { message: 'name must be UPPER_SNAKE_CASE (2-50 chars)' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  /** Full replacement of the permission set when provided. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(PERMISSION_KEYS.length)
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions?: PermissionKey[];
}

export class AssignRolesDto {
  /** Complete set of role ids the user should hold afterwards. */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  roleIds!: string[];
}
