import * as React from 'react';

import { DashQLCoreProvider as PageCoreProvider } from '@akohn/dashql-react/platform/core_provider';
import { CorePanicOverlay } from './core_panic_overlay.js';

// Load the WebAssembly asset through the core package export.
import coreWasmUrl from '@akohn/dashql/wasm?url';
const DASHQL_WASM_URL = typeof coreWasmUrl === 'string' ? coreWasmUrl : new URL(coreWasmUrl as string, import.meta.url).href;

export {
    useDashQLCore,
    useDashQLCoreSetup,
    useDashQLCoreSetupProgress,
    type InstantiationProgress,
} from '@akohn/dashql-react/platform/core_provider';

/// The core of the app, from the WebAssembly that the app serves, and the overlay after a panic of the core
export function DashQLCoreProvider(props: { children: React.ReactNode }) {
    return (
        <PageCoreProvider wasmUrl={DASHQL_WASM_URL}>
            {props.children}
            <CorePanicOverlay />
        </PageCoreProvider>
    );
}
