import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRealm, UserStatus } from '@bi-rem/db';
import { COUNTRY_CODES, E164_PATTERN, SUPPORTED_LOCALES } from '@bi-rem/shared';

import { PaginationQueryDto } from '../../../common/pagination/pagination.js';
import { IsStrongPasswordPolicy } from '../../auth/dto/password.validator.js';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

export const USER_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'email',
  'lastName',
  'lastLoginAt',
  'status',
] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserRealm)
  realm?: UserRealm;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsIn(COUNTRY_CODES)
  countryCode?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  /** Case-insensitive match on email, first or last name. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  search?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  mfaEnabled?: 'true' | 'false';

  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @IsOptional()
  @IsIn(USER_SORT_FIELDS)
  sortBy: UserSortField = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';

  /** Include soft-deleted accounts. */
  @IsOptional()
  @IsIn(['true', 'false'])
  includeDeleted?: 'true' | 'false';
}

export class AdminCreateUserDto {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsEnum(UserRealm)
  realm: UserRealm = 'ADMIN';

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(NAME_PATTERN, { message: 'firstName contains unsupported characters' })
  firstName!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(NAME_PATTERN, { message: 'lastName contains unsupported characters' })
  lastName!: string;

  @IsOptional()
  @Transform(trim)
  @Matches(E164_PATTERN, { message: 'phone must be in E.164 format' })
  phone?: string;

  @IsOptional()
  @IsIn(COUNTRY_CODES)
  countryCode = 'SN';

  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale = 'en';

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  roleIds: string[] = [];

  /** When omitted a random password is generated and an invitation (set-password) link is e-mailed. */
  @IsOptional()
  @IsString()
  @IsStrongPasswordPolicy()
  password?: string;

  @IsOptional()
  @IsBoolean()
  sendInvitation = true;
}

export class AdminUpdateUserDto {
  @IsOptional()
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(NAME_PATTERN)
  firstName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(NAME_PATTERN)
  lastName?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(E164_PATTERN, { message: 'phone must be in E.164 format' })
  phone?: string | null;

  @IsOptional()
  @IsIn(COUNTRY_CODES)
  countryCode?: string;

  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(NAME_PATTERN)
  firstName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(NAME_PATTERN)
  lastName?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(E164_PATTERN, { message: 'phone must be in E.164 format' })
  phone?: string | null;

  @IsOptional()
  @IsIn(COUNTRY_CODES)
  countryCode?: string;

  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: string;
}

export class StatusReasonDto {
  /** Stored in the audit trail. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
