import { Injectable } from '@nestjs/common';
import { notFound } from '../../common/exceptions/app.exception.js';
import { nowIso } from '../../common/utils/dates.js';
import type { UserAccount } from '../../contracts/people.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

const USERS = { collection: 'users', scope: '' };

export interface TicketInput {
  category: string;
  subject: string;
  message: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly store: RecordStoreService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The caller's own UserAccount record (frontend contract). Never includes credentials. */
  async getOwnProfile(userId: string) {
    return (await this.store.find(USERS, userId)) ?? notFound('User');
  }

  /**
   * Opens a support ticket (help centre) or records feedback (settings) on the user's account and
   * notifies the support team, who handle it from Admin → People.
   */
  async openTicket(userId: string, input: TicketInput) {
    const account = (await this.store.find<UserAccount & Entity>(USERS, userId)) ?? notFound('User');
    const ticket = {
      id: RecordStoreService.newId('tk'),
      subject: input.subject.trim(),
      category: input.category,
      message: input.message.trim(),
      status: 'open' as const,
      at: nowIso(),
    };
    await this.store.replace(USERS, {
      ...account,
      supportTickets: [ticket, ...(account.supportTickets ?? [])].slice(0, 100),
      updatedAt: nowIso(),
    });
    const feedback = input.category === 'feedback';
    await this.notifications.pushToPortal(
      'admin',
      {
        portal: 'admin',
        type: 'system',
        title: feedback ? 'নতুন মতামত' : `নতুন সাপোর্ট টিকিট: ${ticket.subject.slice(0, 60)}`,
        body: `${account.name}: ${ticket.message.slice(0, 160)}`,
        href: `/admin/people?user=${encodeURIComponent(userId)}`,
        priority: feedback ? 'low' : 'normal',
      },
      { roles: ['support', 'platform_admin', 'super_admin'] },
    );
    return ticket;
  }
}
