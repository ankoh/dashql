import * as React from 'react';

import { ScriptMetadata } from './script_metadata.js';
import { useCurrentWorkbookState } from './current_workbook.js';
import { SCRIPT_LOADING_FAILED, SCRIPT_LOADING_STARTED, SCRIPT_LOADING_SUCCEEDED, ScriptData, ScriptKey } from './workbook_state.js';

export enum ScriptLoadingStatus {
    PENDING = 1,
    STARTED = 2,
    SUCCEEDED = 3,
    FAILED = 4,
}

export interface ScriptLoadingInfo {
    /// The loading status
    status: ScriptLoadingStatus;
    /// The loading error (if any)
    error: Error | null;
    /// The time at which the loading started (if any)
    startedAt: Date | null;
    /// The time at which the loading finishe (if any)
    finishedAt: Date | null;
}

interface ScriptLoadingState {
    /// The script metadata
    script: ScriptMetadata;
    /// The inflight load
    inflight: Promise<string>;
}

interface LoaderState {
    scripts: Map<string, ScriptLoadingState>;
}
interface Props {
    children?: React.ReactElement;
}

export const ScriptLoader: React.FC<Props> = (props: Props) => {
    const [workbook, modifyWorkbook] = useCurrentWorkbookState();
    const internal = React.useRef<LoaderState>({
        scripts: new Map<string, ScriptLoadingState>(),
    });

    // Load script if needed
    const loadIfNeeded = (script: ScriptData | null) => {
        if (script == null) {
            return;
        }
        // Skip if we're already loading it
        if (script.loading.status != ScriptLoadingStatus.PENDING) {
            return;
        }
        // Mark the script as loading
        modifyWorkbook({
            type: SCRIPT_LOADING_STARTED,
            value: script.scriptKey,
        });
        // Helper to wait for an inflight request
        const waitForResult = async (key: ScriptKey, inflight: Promise<string>) => {
            try {
                const content = await inflight;
                modifyWorkbook({
                    type: SCRIPT_LOADING_SUCCEEDED,
                    value: [key, content],
                });
            } catch (e: any) {
                console.warn(e);
                modifyWorkbook({
                    type: SCRIPT_LOADING_FAILED,
                    value: [key, e],
                });
            }
        };
        // Are we already loading it?
        // This may happen if the user decided to load the script twice.
        // We'll just await the promise and store a duplicated script
        const flightKey = script.scriptKey + (script.metadata.originalScriptName ?? "-");
        const existing = internal.current.scripts.get(flightKey);
        if (existing) {
            return;
        }
        // Otherwise load the url
        let inflight: Promise<string> | null = null;
        if (script.metadata.originalHttpURL) {
            inflight = (async () => {
                const response = await fetch(script.metadata.originalHttpURL!);
                const content = await response.text();
                internal.current.scripts.delete(flightKey);
                return content;
            })();
        }
        // Otherwise start loading
        const loadingState: ScriptLoadingState = {
            script: script.metadata,
            inflight: inflight ?? Promise.reject(`unsupported script type: ${script.metadata.scriptType}`),
        };
        // Register inflight request
        internal.current.scripts.set(flightKey, loadingState);
        // Wait for result
        waitForResult(script.scriptKey, loadingState.inflight);
    };

    // Load scripts on demand
    React.useEffect(() => {
        if (workbook) {
            for (const k in workbook.scripts) {
                const script = workbook.scripts[k];
                loadIfNeeded(script);
            }
        }
    }, [workbook?.scripts, workbook?.connectorInfo]);

    return props.children;
};
