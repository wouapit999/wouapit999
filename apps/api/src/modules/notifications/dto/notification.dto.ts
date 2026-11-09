import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { NotificationChannel, NotificationStatus } from '@bi-rem/db';

import { PaginationQueryDto } from '../../../common/pagination/pagination.js';

const LOCALES = ['en', 'fr', 'pt'] as const;

export class SendNotificationDto {
  @IsUUID()
  userId!: string;

  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  /** Template key, e.g. `welcome` or `password-reset`. */
  @IsString()
  @Matches(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/)
  @MaxLength(64)
  templateKey!: string;

  /** Flat map of template variables. */
  @IsOptional()
  @IsObject()
  variables: Record<string, string | number | boolean> = {};
}

export class UpsertTemplateDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/)
  @MaxLength(64)
  key!: string;

  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsIn(LOCALES)
  locale!: (typeof LOCALES)[number];

  /** Required for EMAIL templates. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  subject?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body!: string;

  /** Placeholder names the body uses; every `{{name}}` must be declared. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/, { each: true })
  variables: string[] = [];

  @IsOptional()
  @IsBoolean()
  isActive = true;
}

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: 'true' | 'false';
}

export class PreferenceDto {
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsBoolean()
  enabled!: boolean;
}

export class UpdatePreferencesDto {
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PreferenceDto)
  preferences!: PreferenceDto[];
}
