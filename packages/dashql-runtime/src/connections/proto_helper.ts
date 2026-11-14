/**
 * Convert Date to ISO 8601 string for JSON schema date-time fields
 */
export function dateToTimestamp(date: Date | null): string | undefined {
    if (!date) return undefined;
    return date.toISOString();
}
