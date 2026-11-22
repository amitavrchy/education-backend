import { Global, Module } from '@nestjs/common';
import { AccessPolicyService } from './access-policy.service.js';

/** Global: every domain module needs record-level access checks. */
@Global()
@Module({
  providers: [AccessPolicyService],
  exports: [AccessPolicyService],
})
export class PermissionsModule {}
