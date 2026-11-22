import type { RuntimePlatform } from '../runtime.js';

/// The next task of the event loop, the tasks that the runtime spawned run until they wait again
const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/// A clock whose sleeps a test can end, so that it waits for no delay of the runtime: the pause after typing, the
/// debounce of the storage, the retry of a write. A sleep that nobody ends ends after its time, like a real one.
export class TestClock {
    private readonly sleeping = new Set<() => void>();

    /// The clock of the platform of the runtime
    readonly clock: RuntimePlatform['clock'] = {
        now: () => Date.now(),
        sleep: ms => new Promise<void>(resolve => {
            const wake = () => {
                clearTimeout(timer);
                this.sleeping.delete(wake);
                resolve();
            };
            const timer = setTimeout(wake, ms);
            this.sleeping.add(wake);
        }),
    };

    /// End every sleep that the runtime waits in now, as if its time passed, and let the tasks that wake up run
    async elapse(): Promise<void> {
        await nextTask();
        for (const wake of [...this.sleeping]) wake();
        await nextTask();
    }
}
