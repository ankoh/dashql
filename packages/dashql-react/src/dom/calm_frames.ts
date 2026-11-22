/// The heavy renders of a view, e.g. the charts and tables of the cards of a dashboard, wait for calm frames: one per
/// idle period of the browser, after the transition of a view. A view shows skeletons until then and stays smooth while
/// it appears, see `Deferred` of `components/deferred`.
export interface RenderSchedule {
    /// Run the task in a calm frame, in the order of the calls. Returns the function that drops the task.
    schedule(task: () => void): () => void;
    /// Hold the tasks until the promise settles, e.g. until the transitions of a view switch end (`transitionsEnd`)
    hold(until: Promise<unknown>): void;
    /// Suspend the heavy renders until the returned function resumes them, e.g. while a panel is dragged. Rendered
    /// content shows its skeleton again and stays mounted, it comes back in calm frames.
    suspend: () => () => void;
    /// Whether the renders are suspended
    suspended: () => boolean;
    /// Call the listener when the renders are suspended or resumed, returns the function that unsubscribes it
    subscribe: (listener: () => void) => () => void;
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

/// Settles when the transitions and animations that run in the element or below it end or are cancelled, e.g. right
/// after the class of a view switch is set. Endless animations, e.g. a spinner, are not waited for. Reading the
/// animations computes the styles, so a transition that a change of the DOM starts counts already.
export function transitionsEnd(element: Element | null): Promise<void> {
    if (element == null || typeof element.getAnimations !== 'function') return Promise.resolve();
    const running = element.getAnimations({ subtree: true }).filter(animation =>
        animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity));
    // A transition that another switch interrupts is cancelled, its promise rejects
    return Promise.allSettled(running.map(animation => animation.finished)).then(() => {});
}

/// Runs one task per idle period. A task usually sets the state of a component, React renders it before the browser
/// is idle again, so the next task waits for that render to be done.
export class CalmFrameSchedule implements RenderSchedule {
    private readonly tasks = new Set<() => void>();
    private holds = 0;
    private suspensions = 0;
    private readonly listeners = new Set<() => void>();
    /// Stops the wait for the next task, null while nothing waits
    private stopWaiting: (() => void) | null = null;

    schedule(task: () => void): () => void {
        // A function scheduled twice runs twice, the set keeps the tasks apart by a wrapper
        const entry = () => task();
        this.tasks.add(entry);
        this.wake();
        return () => { this.tasks.delete(entry); };
    }

    hold(until: Promise<unknown>): void {
        this.holds += 1;
        this.stopWaiting?.();
        this.stopWaiting = null;
        const release = () => {
            this.holds -= 1;
            this.wake();
        };
        until.then(release, release);
    }

    // Arrow functions, React reads them unbound in useSyncExternalStore
    suspend = (): () => void => {
        let resumed = false;
        this.suspensions += 1;
        if (this.suspensions === 1) {
            this.stopWaiting?.();
            this.stopWaiting = null;
            this.notify();
        }
        return () => {
            if (resumed) return;
            resumed = true;
            this.suspensions -= 1;
            if (this.suspensions > 0) return;
            this.notify();
            this.wake();
        };
    };

    suspended = (): boolean => this.suspensions > 0;

    subscribe = (listener: () => void): () => void => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    private notify(): void {
        for (const listener of [...this.listeners]) listener();
    }

    private wake(): void {
        if (this.stopWaiting != null || this.tasks.size === 0 || this.suspensions > 0 || this.holds > 0) return;
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
    suspend: () => () => {},
    suspended: () => false,
    subscribe: () => () => {},
};

/// The schedule of the app
export const CALM_FRAMES: RenderSchedule = new CalmFrameSchedule();
