import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { buildPaginationMeta, PAGINATION, type Paginated } from '@bi-rem/shared';

export class PaginationQueryDto {
  /** 1-based page number. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = PAGINATION.defaultPage;

  /** Items per page (max 100). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION.maxPageSize)
  pageSize: number = PAGINATION.defaultPageSize;
}

export interface PageArgs {
  skip: number;
  take: number;
}

export function toPageArgs(query: Pick<PaginationQueryDto, 'page' | 'pageSize'>): PageArgs {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function paginate<T>(
  items: T[],
  totalItems: number,
  query: Pick<PaginationQueryDto, 'page' | 'pageSize'>,
): Paginated<T> {
  return { data: items, meta: buildPaginationMeta(query.page, query.pageSize, totalItems) };
}
