import { CONTENT_TRANSITIONS, type ContentStatus } from '../contracts/common.js';

const REVIEWERS = ['content_reviewer', 'content_manager', 'platform_admin', 'super_admin'];
const PUBLISHERS = ['content_manager', 'platform_admin', 'super_admin'];

/**
 * Which transitions a role may perform (frontend review.service allowedTransitions):
 * reviewers move items through review, publishers publish/archive, authors submit/withdraw.
 */
export function allowedTransitions(status: ContentStatus, role: string): ContentStatus[] {
  const reviewer = REVIEWERS.includes(role);
  const publisher = PUBLISHERS.includes(role);
  return CONTENT_TRANSITIONS[status].filter((to) => {
    if (to === 'published' || to === 'archived') return publisher;
    if (to === 'in_review' || to === 'approved' || to === 'changes_requested') return reviewer;
    return true; // submitted / draft: authors
  });
}
