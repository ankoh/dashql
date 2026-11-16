/// Decides when the store of the views of a runtime takes the changes of the runtime
export interface UpdateScheduler {
    /// Run the callback at the end of the current task
    afterTask(callback: () => void): void;
    /// Run the callback once before the next frame, returns the handle that cancels it
    beforeFrame(callback: () => void): unknown;
    /// Cancel a callback of beforeFrame
    cancelFrame(handle: unknown): void;
}

/// Schedules without frames, where nothing renders: changes that may wait for a frame wait for the next task
export const TASK_UPDATE_SCHEDULER: UpdateScheduler = {
    afterTask: callback => queueMicrotask(callback),
    beforeFrame: callback => setTimeout(callback, 0),
    cancelFrame: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
