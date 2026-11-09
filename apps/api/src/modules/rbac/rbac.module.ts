import { Global, Module } from '@nestjs/common';

import { REDIS_CLIENT, type RedisClient } from '../../redis/redis.module.js';
import {
  InMemoryPermissionCache,
  PERMISSION_CACHE,
  type PermissionCacheStore,
  RedisPermissionCache,
} from './permission-cache.js';
import { PermissionResolverService } from './permission-resolver.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { PermissionsController, RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';
import { UserRolesController } from './user-roles.controller.js';
import { UserRolesService } from './user-roles.service.js';

@Global()
@Module({
  controllers: [RolesController, PermissionsController, UserRolesController],
  providers: [
    {
      provide: PERMISSION_CACHE,
      inject: [REDIS_CLIENT],
      useFactory: (redis: RedisClient): PermissionCacheStore =>
        redis ? new RedisPermissionCache(redis) : new InMemoryPermissionCache(),
    },
    PermissionResolverService,
    PermissionsGuard,
    RolesService,
    UserRolesService,
  ],
  exports: [PermissionResolverService, PermissionsGuard, RolesService, UserRolesService],
})
export class RbacModule {}
