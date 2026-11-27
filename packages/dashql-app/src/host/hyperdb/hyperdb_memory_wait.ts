/// The waits before the engine asks for its memory again, about 6 s in all
export const HYPERDB_MEMORY_WAITS_MS: readonly number[] = [100, 200, 400, 800, 1600, 3200];

/// Did WebKit refuse the memory of the engine? The worker fails while it evaluates the engine script, the client of
/// the engine reports the message of that error event, e.g. "RangeError: Out of memory".
export function isOutOfMemoryError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\bOut of memory\b/i.test(message);
}

/// Start the engine, and wait for the memory of the last page if WebKit refuses the memory of this one.
///
/// The engine reserves a shared WebAssembly.Memory with a maximum of 4 GiB, and WebKit charges that maximum against
/// the address space of its process. Right after a reload the worker of the last page is stopped but its memory may not
/// be released yet, and Safari of iOS fails the memory of the new page with "Out of memory". The setup waits and starts
/// the engine again, with the same memory, until the waits run out.
export async function startWaitingForMemory<T>(
    start: () => Promise<T>,
    onWait: (error: unknown, waitMs: number) => void,
    waits: readonly number[] = HYPERDB_MEMORY_WAITS_MS,
): Promise<T> {
    for (let attempt = 0; ; ++attempt) {
        try {
            return await start();
        } catch (error) {
            if (attempt >= waits.length || !isOutOfMemoryError(error)) throw error;
            onWait(error, waits[attempt]);
            await new Promise(resolve => setTimeout(resolve, waits[attempt]));
        }
    }
}
