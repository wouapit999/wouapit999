import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const RULE_ATTRIBUTES = ['userId', 'realm', 'countryCode', 'emailDomain', 'role'] as const;
export const RULE_OPERATORS = ['eq', 'in', 'not_in'] as const;

/** Targeting rule: when any rule matches the evaluation context the flag is on for that subject. */
export class FeatureFlagRuleDto {
  @IsIn(RULE_ATTRIBUTES)
  attribute!: (typeof RULE_ATTRIBUTES)[number];

  @IsIn(RULE_OPERATORS)
  op!: (typeof RULE_OPERATORS)[number];

  /** A string for `eq`, a string array for `in` / `not_in`. */
  @IsOptional()
  value?: string | string[];
}

export class UpsertFeatureFlagDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Percentage of users (bucketed by a stable hash) who see the flag when it is enabled. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage = 100;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FeatureFlagRuleDto)
  rules: FeatureFlagRuleDto[] = [];
}
