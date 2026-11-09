import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRealm } from '@bi-rem/db';
import { COUNTRY_CODES, E164_PATTERN, SUPPORTED_LOCALES } from '@bi-rem/shared';

import { IsStrongPasswordPolicy } from './password.validator.js';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;

export class RegisterDto {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsStrongPasswordPolicy()
  password!: string;

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

  /** E.164 phone number, e.g. +221771234567. */
  @IsOptional()
  @Transform(trim)
  @Matches(E164_PATTERN, { message: 'phone must be in E.164 format' })
  phone?: string;

  /** ISO-3166-1 alpha-2 country code. */
  @IsIn(COUNTRY_CODES)
  countryCode!: string;

  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale = 'en';

  @Equals(true, { message: 'You must accept the terms of service' })
  acceptTerms!: boolean;

  @IsOptional()
  @IsBoolean()
  marketingOptIn = false;
}

export class LoginDto {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  /** Defaults to CUSTOMER; the admin portal uses `/auth/admin/login` instead. */
  @IsOptional()
  @IsEnum(UserRealm)
  realm: UserRealm = 'CUSTOMER';

  /** Optional device label stored with the refresh-token session. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  deviceName?: string;
}

export class AdminLoginDto {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  deviceName?: string;
}

export class RefreshTokenDto {
  @IsString()
  @Length(20, 4096)
  refreshToken!: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  @Length(20, 4096)
  refreshToken?: string;

  /** Revokes every session of the user, not just the current one. */
  @IsOptional()
  @IsBoolean()
  allDevices = false;
}

export class MfaVerifyDto {
  /** Challenge token returned by the first login step. */
  @IsString()
  @Length(20, 4096)
  mfaToken!: string;

  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class MfaEnableDto {
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class MfaDisableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class PasswordResetRequestDto {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsEnum(UserRealm)
  realm: UserRealm = 'CUSTOMER';
}

export class PasswordResetConfirmDto {
  @IsString()
  @Length(20, 4096)
  token!: string;

  @IsString()
  @IsStrongPasswordPolicy()
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @IsStrongPasswordPolicy()
  newPassword!: string;
}
