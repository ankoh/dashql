import * as React from 'react';
import { flushSync } from 'react-dom';

function fallbackAct<T>(callback: () => T | Promise<T>): T | Promise<T> {
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

export const act: typeof React.act = React.act ?? fallbackAct as typeof React.act;

/// Wait until a rendered state holds.
/// The development React of the dev server renders the updates of an act scope when the scope ends, a wait inside
/// one scope would never see them. So every attempt gets a scope of its own, and the wait stays inside the scopes:
/// an update between two of them would warn that it was not wrapped in act.
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
/// Production React has no act, and flushSync renders only the sync lane. React schedules the continuous lane in a
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
