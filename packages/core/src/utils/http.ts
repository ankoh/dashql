import * as error from '../error';

const defaultTimeout = 7000;

// Fetch something with timeout
export function loadWithTimeout<T>(url: string, options: RequestInit, timeout: number = defaultTimeout): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fetchPromise = fetch(url, options)
        .then(resp => {
            if (timer != null) clearTimeout(timer);
            if (!resp.ok) {
                throw new error.HTTPStatusError(resp.status);
            }
            return resp.json();
        })
        .then(data => {
            return data as T;
        });
    const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new error.LoggableError('timeout')), timeout);
    });
    return Promise.race([fetchPromise, timeoutPromise]);
}
