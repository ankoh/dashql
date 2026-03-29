
declare const WEBDB_PRECOMPILED: Promise<Uint8Array> | undefined;

export interface WebDBTestConfig {
    wasmPath?: string;
    wasmBinary?: Uint8Array;
    skipTests: boolean;
    skipReason?: string;
}

let cachedConfig: WebDBTestConfig | null = null;

export async function getWebDBTestConfig(): Promise<WebDBTestConfig> {
    if (cachedConfig) {
        return cachedConfig;
    }

    // Try precompiled binary first
    if (typeof WEBDB_PRECOMPILED === 'undefined') {
        throw new Error("WebDB is not precompiled");
    }
    try {
        const wasmBinary = await WEBDB_PRECOMPILED;
        cachedConfig = {
            wasmBinary,
            skipTests: false,
        };
        return cachedConfig;
    } catch (e) {
        // No WASM found - skip tests
        cachedConfig = {
            skipTests: true,
            skipReason: 'WebDB WASM file not found. Build with: bazel build //packages/duckdb-wasm:webdb_wasm',
        };
        console.warn('Failed to load WEBDB_PRECOMPILED:', e);
    }
    return cachedConfig;
}

/**
 * Reset the cached configuration (useful for testing)
 */
export function resetWebDBTestConfig(): void {
    cachedConfig = null;
}
