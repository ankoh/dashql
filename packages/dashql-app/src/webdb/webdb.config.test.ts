/**
 * WebDB Test Configuration
 *
 * This file handles WASM loading for tests with multiple strategies:
 * 1. Precompiled binary (injected by build system)
 * 2. URL import (for bundled WASM files)
 * 3. Environment variable override
 */

import * as path from 'path';
import * as fs from 'fs';

// Strategy 1: Try to use precompiled binary (like core tests)
// This is provided by the build system in some configurations
declare const WEBDB_PRECOMPILED: Promise<Uint8Array> | undefined;

// Strategy 2: Try to import WASM URL (like compute tests)
// Uncomment when the package is properly set up:
// import wasmUrl from '@dashql/duckdb-wasm?url';

// Strategy 3: Environment variable fallback
const WASM_ENV_PATH = process.env.WEBDB_WASM_PATH;

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
    if (typeof WEBDB_PRECOMPILED !== 'undefined') {
        try {
            const wasmBinary = await WEBDB_PRECOMPILED;
            cachedConfig = {
                wasmBinary,
                skipTests: false,
            };
            return cachedConfig;
        } catch (e) {
            console.warn('Failed to load WEBDB_PRECOMPILED:', e);
        }
    }

    // Try URL import (when uncommented)
    // if (typeof wasmUrl !== 'undefined') {
    //     const resolvedPath = path.resolve(wasmUrl.startsWith('/') ? wasmUrl.slice(1) : wasmUrl);
    //     try {
    //         await fs.promises.access(resolvedPath);
    //         cachedConfig = {
    //             wasmPath: resolvedPath,
    //             skipTests: false,
    //         };
    //         return cachedConfig;
    //     } catch (e) {
    //         console.warn(`WebDB WASM file not found at ${resolvedPath}:`, e);
    //     }
    // }

    // Try environment variable
    if (WASM_ENV_PATH) {
        const resolvedPath = path.resolve(WASM_ENV_PATH.startsWith('/') ? WASM_ENV_PATH.slice(1) : WASM_ENV_PATH);
        try {
            await fs.promises.access(resolvedPath);
            cachedConfig = {
                wasmPath: resolvedPath,
                skipTests: false,
            };
            return cachedConfig;
        } catch (e) {
            console.warn(`WebDB WASM file not found at ${resolvedPath}:`, e);
        }
    }

    // Default fallback - check common build locations
    const defaultPaths = [
        './bazel-bin/packages/duckdb-wasm/webdb_wasm.wasm',
        './packages/duckdb-wasm/webdb_wasm.wasm',
        '../duckdb-wasm/bazel-bin/webdb_wasm.wasm',
    ];

    for (const defaultPath of defaultPaths) {
        const resolvedPath = path.resolve(defaultPath);
        try {
            await fs.promises.access(resolvedPath);
            cachedConfig = {
                wasmPath: resolvedPath,
                skipTests: false,
            };
            console.log(`Found WebDB WASM at: ${resolvedPath}`);
            return cachedConfig;
        } catch (e) {
            // Continue to next path
        }
    }

    // No WASM found - skip tests
    cachedConfig = {
        skipTests: true,
        skipReason: 'WebDB WASM file not found. Build with: bazel build //packages/duckdb-wasm:webdb_wasm',
    };

    console.warn(cachedConfig.skipReason);
    return cachedConfig;
}

/**
 * Reset the cached configuration (useful for testing)
 */
export function resetWebDBTestConfig(): void {
    cachedConfig = null;
}
