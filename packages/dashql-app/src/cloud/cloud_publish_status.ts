import * as React from 'react';

import { stringifyError } from '@akohn/dashql/platform/logger/logger';

/// The latest publish of a workbook to a cloud
export interface CloudPublishStatus {
    phase: 'publishing' | 'published' | 'failed';
    error: string | null;
}

const statuses = new Map<string, CloudPublishStatus>();
const listeners = new Set<() => void>();

function setStatus(workbookId: string, status: CloudPublishStatus): void {
    statuses.set(workbookId, status);
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/// Follow a publish of a workbook, the status of the workbook tells it
export function trackCloudPublish<T>(workbookId: string, publish: Promise<T>): Promise<T> {
    setStatus(workbookId, { phase: 'publishing', error: null });
    publish.then(
        () => setStatus(workbookId, { phase: 'published', error: null }),
        error => setStatus(workbookId, { phase: 'failed', error: stringifyError(error) }),
    );
    return publish;
}

/// The latest publish of a workbook in this session, null without
export function useCloudPublishStatus(workbookId: string): CloudPublishStatus | null {
    return React.useSyncExternalStore(subscribe, () => statuses.get(workbookId) ?? null);
}
