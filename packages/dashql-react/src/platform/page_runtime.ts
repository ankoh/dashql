import * as React from 'react';

import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { useOwnedRuntime } from '../hooks.js';

/// The runtime of a page (docs/design/dashql_runtime.md): created with the first render and destroyed with the
/// component (`useOwnedRuntime`). The compute database is set up right away, so a page shows early whether runs can
/// read results. The storage writer debounces its writes and flushes them when the page hides: a page that goes away
/// flushes with `closing`, browsers don't wait for writes when a page unloads, a hidden page usually still finishes
/// them. A page that goes to the back-forward cache comes back with its writes pending.
export function usePageRuntime(create: () => Runtime): Runtime {
    const runtime = useOwnedRuntime(create);

    React.useEffect(() => runtime.computeDatabase.prepare(), [runtime]);

    React.useEffect(() => {
        const flush = (closing: boolean) => void flushRuntimeStorage(runtime, closing);
        const flushIfHidden = () => {
            if (document.visibilityState === 'hidden') flush(false);
        };
        const flushOnPageHide = (event: PageTransitionEvent) => flush(!event.persisted);
        window.addEventListener('pagehide', flushOnPageHide);
        document.addEventListener('visibilitychange', flushIfHidden);
        return () => {
            window.removeEventListener('pagehide', flushOnPageHide);
            document.removeEventListener('visibilitychange', flushIfHidden);
        };
    }, [runtime]);

    return runtime;
}

/// Write the pending changes of the storage writer of a runtime, a failure is logged. With `closing`, the scripts that
/// a change outside the page holds are kept as recovery copies next to them.
export async function flushRuntimeStorage(runtime: Runtime, closing: boolean): Promise<void> {
    try {
        await runtime.storage.flush({ closing });
    } catch (error) {
        runtime.logger.error('Failed to flush the storage writer', { error: stringifyError(error) }, 'runtime');
    }
}
