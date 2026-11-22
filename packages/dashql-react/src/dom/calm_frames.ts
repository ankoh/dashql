/// The heavy renders of a view, e.g. the charts and tables of the cards of a dashboard, wait for calm frames: one per
/// idle period of the browser, after the transition of a view. A view shows skeletons until then and stays smooth while
/// it appears, see `Deferred` of `components/deferred`.
export interface RenderSchedule {
    /// Run the task in a calm frame, in the order of the calls. Returns the function that drops the task.
    schedule(task: () => void): () => void;
    /// Hold the tasks for the given milliseconds, e.g. while a view transition runs
    hold(ms: number): void;
}

/// A task waits at most this long for an idle period, a busy page still makes progress
const IDLE_TIMEOUT_MS = 1000;

/// Wait for an idle period of the browser, returns the function that stops waiting.
/// Without idle callbacks (Safari) the task runs after the next frame, once its work is done.
function whenIdle(callback: () => void): () => void {
    if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(() => callback(), { timeout: IDLE_TIMEOUT_MS });
        return () => cancelIdleCallback(id);
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const frame = requestAnimationFrame(() => { timeout = setTimeout(callback, 0); });
    return () => {
        cancelAnimationFrame(frame);
        if (timeout != null) clearTimeout(timeout);
    };
}

/// Runs one task per idle period. A task usually sets the state of a component, React renders it before the browser
/// is idle again, so the next task waits for that render to be done.
export class CalmFrameSchedule implements RenderSchedule {
    private readonly tasks = new Set<() => void>();
    private heldUntil = 0;
    /// Stops the wait for the next task, null while nothing waits
    private stopWaiting: (() => void) | null = null;

    schedule(task: () => void): () => void {
        // A function scheduled twice runs twice, the set keeps the tasks apart by a wrapper
        const entry = () => task();
        this.tasks.add(entry);
        this.wake();
        return () => { this.tasks.delete(entry); };
    }

    hold(ms: number): void {
        this.heldUntil = Math.max(this.heldUntil, performance.now() + ms);
        this.stopWaiting?.();
        this.stopWaiting = null;
        this.wake();
    }

    private wake(): void {
        if (this.stopWaiting != null || this.tasks.size === 0) return;
        const held = this.heldUntil - performance.now();
        if (held > 0) {
            const timeout = setTimeout(() => {
                this.stopWaiting = null;
                this.wake();
            }, held);
            this.stopWaiting = () => clearTimeout(timeout);
            return;
        }
        this.stopWaiting = whenIdle(() => {
            this.stopWaiting = null;
            const next = this.tasks.values().next();
            if (!next.done) {
                this.tasks.delete(next.value);
                next.value();
            }
            this.wake();
        });
    }
}

/// Runs every task right away, e.g. in tests that look at the rendered content
export const IMMEDIATE_SCHEDULE: RenderSchedule = {
    schedule: task => {
        task();
        return () => {};
    },
    hold: () => {},
};

/// The schedule of the app
export const CALM_FRAMES: RenderSchedule = new CalmFrameSchedule();
