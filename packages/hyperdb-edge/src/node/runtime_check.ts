import v8 from 'node:v8';

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/// The smallest modules that use a WebAssembly feature of the engine of hyperdb-wasm, a wasm64 build
export const WASM_FEATURE_MODULES = {
    /// A memory with 64-bit addresses
    memory64: new Uint8Array([...HEADER, 0x05, 0x03, 0x01, 0x04, 0x01]),
    /// A table with 64-bit indices
    table64: new Uint8Array([...HEADER, 0x04, 0x04, 0x01, 0x70, 0x04, 0x01]),
    /// A function that returns an exnref, the exception handling of the engine
    exnref: new Uint8Array([...HEADER, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x69]),
} as const;

type Feature = keyof typeof WASM_FEATURE_MODULES;

/// The flag that turns on exnref in Node 24.0 to 24.14, Node 24.15 has it without
const EXNREF_FLAG = '--experimental-wasm-exnref';

export interface RuntimeEnvironment {
    validate(bytes: Uint8Array): boolean;
    setFlags(flags: string): void;
    readonly execPath: string;
    readonly version: string;
}

/// The WebAssembly of the runtime, the types of Node don't declare it
export const WEB_ASSEMBLY = (globalThis as unknown as { WebAssembly: { validate(bytes: Uint8Array): boolean } }).WebAssembly;

const NODE_ENVIRONMENT: RuntimeEnvironment = {
    validate: bytes => WEB_ASSEMBLY.validate(bytes),
    setFlags: flags => v8.setFlagsFromString(flags),
    execPath: process.execPath,
    version: process.version,
};

export class UnsupportedRuntimeError extends Error {
    constructor(
        message: string,
        readonly missing: Feature[],
    ) {
        super(message);
        this.name = 'UnsupportedRuntimeError';
    }
}

/// Check that this node runs the engine before it loads, instead of failing inside V8. hyperdb-edge and the embedded
/// Hyper of the runtime of DashQL check with it.
/// The node of an agent harness may not be the one of the shell: MCP servers and hooks start without the login shell,
/// and other tools put an older node first on the PATH. So the error names the node that runs.
/// Node 24 before 24.15 has exnref behind a flag. A flag on the command line would break approving the command by
/// its prefix, so the check sets it in V8 before the engine compiles, the worker of the engine then has it as well.
export function checkWasmFeatures(env: RuntimeEnvironment = NODE_ENVIRONMENT): void {
    const features = Object.keys(WASM_FEATURE_MODULES) as Feature[];
    let missing = features.filter(feature => !env.validate(WASM_FEATURE_MODULES[feature]));
    if (missing.includes('exnref')) {
        env.setFlags(EXNREF_FLAG);
        if (env.validate(WASM_FEATURE_MODULES.exnref)) {
            missing = missing.filter(feature => feature !== 'exnref');
        }
    }
    if (missing.length > 0) {
        throw new UnsupportedRuntimeError(
            `${env.execPath} (Node ${env.version}) lacks the WebAssembly ${missing.length === 1 ? 'feature' : 'features'} ` +
                `${missing.join(', ')} that hyperdb-wasm needs. It needs Node 24 or later.`,
            missing,
        );
    }
}
