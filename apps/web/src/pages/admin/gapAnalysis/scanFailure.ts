import type { TFunction } from 'i18next'
import { withServerMessageDetail } from '@/lib/withServerMessageDetail'

/** The two fields of a failed scan's run row, movies and TV alike. */
export interface FailedScan {
  failureReason: 'interrupted' | 'tmdbSilent' | 'tmdbPartial' | null
  errorMessage: string | null
}

/** Why a scan failed: in the reader's language when the cause is known, else the server's words. */
export function describeScanFailure(t: TFunction, run: FailedScan): string {
  switch (run.failureReason) {
    case 'interrupted':
      return t('admin.gaps.failureReason.interrupted')
    case 'tmdbSilent':
      return t('admin.gaps.failureReason.tmdbSilent')
    case 'tmdbPartial':
      return t('admin.gaps.failureReason.tmdbPartial')
    default:
      return run.errorMessage ? withServerMessageDetail(t, run.errorMessage) : ''
  }
}
