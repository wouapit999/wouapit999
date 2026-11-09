import {
  IsEnum,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { AuditOutcome } from '@bi-rem/db';

import { PaginationQueryDto } from '../../../common/pagination/pagination.js';

export class AuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  actorId?: string;

  /** Dotted action name, e.g. `users.update`. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/)
  @MaxLength(128)
  action?: string;

  /** PascalCase resource type, e.g. `User`. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Za-z0-9]*$/)
  @MaxLength(64)
  resource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  resourceId?: string;

  @IsOptional()
  @IsEnum(AuditOutcome)
  outcome?: AuditOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  correlationId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
