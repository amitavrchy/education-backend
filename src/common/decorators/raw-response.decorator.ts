import { SetMetadata } from '@nestjs/common';
import { RAW_RESPONSE_KEY } from '../constants/metadata-keys.js';

/** Skip the `{ success, data }` envelope (health probes, file streams, webhooks). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
