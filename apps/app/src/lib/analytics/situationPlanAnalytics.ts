import { trackGoogleAnalyticsEvent } from './googleAnalytics'

/** These event names intentionally carry the action so no custom GA4 dimension is needed. */
export function trackSituationPlanBulkDeleteWarningShown(): void {
  trackGoogleAnalyticsEvent('plan_bulk_delete_warning_shown')
}

export function trackSituationPlanBulkDeleteHide(): void {
  trackGoogleAnalyticsEvent('plan_bulk_delete_hide')
}

export function trackSituationPlanBulkDeleteDelete(): void {
  trackGoogleAnalyticsEvent('plan_bulk_delete_delete')
}

export function trackSituationPlanBulkDeleteCancel(): void {
  trackGoogleAnalyticsEvent('plan_bulk_delete_cancel')
}
