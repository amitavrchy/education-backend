import { Injectable } from '@nestjs/common';
import { notFound } from '../../common/exceptions/app.exception.js';
import { RecordStoreService } from '../records/record-store.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly store: RecordStoreService) {}

  /** The caller's own UserAccount record (frontend contract). Never includes credentials. */
  async getOwnProfile(userId: string) {
    return (await this.store.find({ collection: 'users', scope: '' }, userId)) ?? notFound('User');
  }
}
