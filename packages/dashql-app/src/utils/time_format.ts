/**
 * Format a timestamp as relative time (e.g., "2 hours ago", "Yesterday")
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
    if (!date) return 'Never';

    const timestamp = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 10) {
        return 'Just now';
    } else if (diffSec < 60) {
        return `${diffSec} seconds ago`;
    } else if (diffMin === 1) {
        return '1 minute ago';
    } else if (diffMin < 60) {
        return `${diffMin} minutes ago`;
    } else if (diffHour === 1) {
        return '1 hour ago';
    } else if (diffHour < 24) {
        return `${diffHour} hours ago`;
    } else if (diffDay === 1) {
        return 'Yesterday';
    } else if (diffDay < 7) {
        return `${diffDay} days ago`;
    } else if (diffDay < 30) {
        const weeks = Math.floor(diffDay / 7);
        return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    } else if (diffDay < 365) {
        const months = Math.floor(diffDay / 30);
        return months === 1 ? '1 month ago' : `${months} months ago`;
    } else {
        const years = Math.floor(diffDay / 365);
        return years === 1 ? '1 year ago' : `${years} years ago`;
    }
}
