import type * as React from 'react';
import { flushSync } from 'react-dom';

/// The tests run on this act in every build, also where React brings its own.
/// Production React has no act. The act of development React renders the updates of a scope only when the outermost
/// scope ends, so nested calls see nothing yet, and a test that hangs inside a scope stops the rendering of the tests
/// after it. The tests would pass in the bundle and fail on the dev server.
function flushSyncAct<T>(callback: () => T | Promise<T>): T | Promise<T> {
    let result!: T | Promise<T>;
    flushSync(() => {
        result = callback();
    });
    if (result && typeof (result as Promise<T>).then === 'function') {
        return Promise.resolve(result).then(resolved => {
            flushSync(() => {});
            return resolved;
        });
    }
    flushSync(() => {});
    return result;
}

export const act = flushSyncAct as typeof React.act;

/// Wait until a rendered state holds, every attempt renders the pending updates first.
export async function waitForRender(rendered: () => void): Promise<void> {
    for (let attempt = 1; ; ++attempt) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
        try {
            rendered();
            return;
        } catch (error) {
            if (attempt >= 1000) throw error;
        }
    }
}

/// Wait until React has rendered the updates of continuous events (pointermove, pointerover, pointerout, ...).
/// The act of the tests is flushSync, which renders only the sync lane. React schedules the continuous lane in a
/// microtask that posts a Scheduler task through a MessageChannel and renders that lane without time slicing, so the
/// update is committed once a message posted after that microtask arrives. Waiting for a frame races with that task.
export async function flushContinuousUpdates(): Promise<void> {
    await Promise.resolve();
    await new Promise<void>(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}
