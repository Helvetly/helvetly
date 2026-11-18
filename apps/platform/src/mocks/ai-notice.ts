import type { AINotice, HeidiConsent } from '@/lib/heidi'

// The API's own notice file, so stories and tests show the words people approve.
import file from '../../../api/internal/ainotice/notice.json'

/** GET /api/v1/heidi/consent's notice, in English. */
export const aiNotice: AINotice = { version: file.version, ...file.texts.en }

/** The person's choice: approved the notice in force, or not yet (no row). */
export const aiConsent = (granted: boolean): HeidiConsent =>
  granted
    ? {
        granted: true,
        version: file.version,
        current_version: file.version,
        changed_at: '2026-11-16T10:00:00Z',
        changed_by: 'Anna',
      }
    : {
        granted: false,
        version: '',
        current_version: file.version,
        changed_at: null,
        changed_by: '',
      }
