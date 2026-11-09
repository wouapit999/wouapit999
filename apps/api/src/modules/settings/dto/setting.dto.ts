import { IsBoolean, IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertSettingDto {
  /** Any JSON value. Secret values are encrypted at rest and never returned in clear. */
  @IsDefined()
  value!: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isSecret = false;
}
