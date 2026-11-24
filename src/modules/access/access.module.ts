import { Global, Module } from '@nestjs/common';
import { DocumentsService } from '../records/documents.service.js';
import { AccessPolicyService } from './access-policy.service.js';
import { PermissionMatrixService } from './permission-matrix.service.js';

/** Global: the permission matrix (used by the auth guard) and record-level access policy. */
@Global()
@Module({
  providers: [DocumentsService, PermissionMatrixService, AccessPolicyService],
  exports: [DocumentsService, PermissionMatrixService, AccessPolicyService],
})
export class AccessModule {}
