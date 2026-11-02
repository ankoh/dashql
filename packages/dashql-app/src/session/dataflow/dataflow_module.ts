import * as React from 'react';
import * as core from '@ankoh/dashql-core';

// The layout module is an asset of the core package, loaded when the dataflow canvas opens
// eslint-disable-next-line import/no-unresolved -- resolved by bundler
import dataflowWasmUrl from '@ankoh/dashql-core/dataflow-wasm?url';
const DATAFLOW_WASM_URL = typeof dataflowWasmUrl === 'string' ? dataflowWasmUrl : new URL(dataflowWasmUrl as string, import.meta.url).href;

let loading: Promise<core.DashQLDataflow> | null = null;

/// Load the layout module of the dataflow canvas once, a failed load is tried again by the next call
export function loadDataflowModule(): Promise<core.DashQLDataflow> {
    loading ??= (async () => {
        const response = await fetch(DATAFLOW_WASM_URL);
        if (!response.ok) throw new Error(`Failed to fetch the layout wasm: ${response.status} ${response.statusText}`);
        return core.DashQLDataflow.create({ wasmBinary: new Uint8Array(await response.arrayBuffer()) });
    })();
    loading.catch(() => {
        loading = null;
    });
    return loading;
}

/// The layout module of the dataflow canvas, null while it loads
export interface DataflowModule {
    layout: core.DashQLDataflow | null;
    error: Error | null;
}

/// Load the layout module of the dataflow canvas when a canvas mounts
export function useDataflowModule(): DataflowModule {
    const [state, setState] = React.useState<DataflowModule>({ layout: null, error: null });
    React.useEffect(() => {
        let cancelled = false;
        loadDataflowModule().then(
            layout => { if (!cancelled) setState({ layout, error: null }); },
            error => { if (!cancelled) setState({ layout: null, error: error instanceof Error ? error : new Error(String(error)) }); },
        );
        return () => { cancelled = true; };
    }, []);
    return state;
}
