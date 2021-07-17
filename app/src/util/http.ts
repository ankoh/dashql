import { HTTPStatusError, LoggableError } from '../util/error';

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
                throw new HTTPStatusError(resp.status);
            }
            return resp.json();
        })
        .then(data => {
            return data as T;
        });
    const timeoutPromise = new Promise<T>((_, reject) => {
        return setTimeout(() => reject(new LoggableError('timeout')), timeout);
    });
    return Promise.race([fetchPromise, timeoutPromise]);
}
