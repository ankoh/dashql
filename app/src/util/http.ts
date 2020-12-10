import { error } from '@dashql/core';

const defaultTimeout = 7000;

// Fetch something with timeout
export function loadWithTimeout<T>(
    url: string,
    options: RequestInit,
    timeout: number = defaultTimeout,
): Promise<T> {
    const fetchPromise = fetch(url, options)
        .then(resp => {
            if (!resp.ok) {
                throw new error.HTTPStatusError(resp.status);
            }
            return resp.json();
        })
        .then(data => {
            return data as T;
        });
    const timeoutPromise = new Promise<T>((_, reject) => {
        return setTimeout(() => reject(new error.LoggableError('timeout')), timeout);
    });
    return Promise.race([fetchPromise, timeoutPromise]);
}
