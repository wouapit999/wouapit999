import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateApiKeyDto {
  /** Human-readable label, e.g. `reporting-service`. */
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** Permission keys or wildcards (`users:read`, `audit:*`, `*`). */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(/^(\*|[a-z][a-z0-9-]*:(\*|[a-z][a-z0-9-]*))$/, {
    each: true,
    message: 'each scope must be resource:action, resource:* or *',
  })
  scopes!: string[];

  /** Optional ISO-8601 expiry. */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
