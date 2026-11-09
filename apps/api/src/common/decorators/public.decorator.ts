import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'bi-rem:isPublic';

/** Marks a route as reachable without authentication (JWT or API key). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
