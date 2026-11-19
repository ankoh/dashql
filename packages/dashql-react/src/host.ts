import * as React from 'react';
import type * as dashql from '@akohn/dashql';

import { downloadFile } from './dom/download_file.js';

// What a host provides the components besides models (docs/agents/writing_components.md): its core module and the
// files it saves for the user. A component reads them with `useHost`, the host fills them once with `HostProvider`.
// The logger (`useLogger` of `logger.ts`) and the brand (`useBrand` of `brand/brand.ts`) are contexts of their own, a
// host provides them above everything else, also above its core.

/// Set up the core module of the host, e.g. to lay out a plan or to format a SQL text
export type CoreSetup = (context: string) => Promise<dashql.DashQL>;
/// Save bytes as a file of the user, resolves once the host took the file
export type DownloadFile = (data: Uint8Array | Blob, fileName: string) => Promise<void>;

/// The services of a host
export interface Host {
    /// Set up the core module, null in a host without one: a plan then keeps its orientation
    setupCore: CoreSetup | null;
    /// Save a file of the user, a download of the browser by default
    downloadFile: DownloadFile;
}

/// The host of components without a provider: no core, files download through the browser
const DEFAULT_HOST: Host = { setupCore: null, downloadFile };

const HOST = React.createContext<Host>(DEFAULT_HOST);

/// Hand the components below the services of the host, e.g. a spy for the downloads of a test
export const HostProvider = HOST.Provider;

/// The services of the host
export function useHost(): Host {
    return React.useContext(HOST);
}
