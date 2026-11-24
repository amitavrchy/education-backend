// Mirrored from frontend/src/contracts/index.ts — the frontend contract is the source of truth.
// Refresh with: npm run contracts:sync
/**
 * Domain contracts — the typed models shared by services, hooks and UI.
 * Platform-neutral shapes are documented in docs/api/API_CONTRACTS.md so the
 * Flutter app (separate repo) can implement equivalent models.
 */
export * from './common.js';
export * from './curriculum.js';
export * from './question.js';
export * from './learning.js';
export * from './assessment.js';
export * from './study.js';
export * from './people.js';
export * from './operations.js';
