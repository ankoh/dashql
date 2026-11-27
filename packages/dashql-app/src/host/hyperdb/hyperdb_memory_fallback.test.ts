import { describe, expect, it } from 'vitest';

import { HYPERDB_MEMORY_FALLBACK_SOURCE } from './hyperdb_memory_fallback.js';

/// Run the fallback in a worker of an object URL, like the worker of the engine, then a body that posts its result
async function runInWorker<T>(source: string): Promise<T> {
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    const worker = new Worker(url);
    try {
        return await new Promise<T>((resolve, reject) => {
            worker.onmessage = event => resolve(event.data as T);
            worker.onerror = event => reject(new Error(event.message));
        });
    } finally {
        worker.terminate();
        URL.revokeObjectURL(url);
    }
}

interface FakeResult {
    /// The maximum of each memory that was constructed
    constructed: (number | null)[];
    /// The maximum of the memory, null if none was created
    maximum: number | null;
    instanceOfFallback: boolean;
    error: string | null;
}

/// Construct a memory with a WebAssembly whose memories fit up to a maximum, like the address space WebKit has left
function constructWithFake(fits: number | null, descriptor: WebAssembly.MemoryDescriptor): Promise<FakeResult> {
    return runInWorker<FakeResult>(`
const constructed = [];
class FakeMemory {
    constructor(descriptor) {
        constructed.push(descriptor.maximum ?? null);
        if (${JSON.stringify(fits)} != null && (descriptor.maximum ?? Infinity) > ${JSON.stringify(fits)}) throw new RangeError('Out of memory');
        this.maximum = descriptor.maximum ?? null;
    }
}
const wasm = { Memory: FakeMemory };
(function (WebAssembly) {
${HYPERDB_MEMORY_FALLBACK_SOURCE}
})(wasm);
try {
    const memory = new wasm.Memory(${JSON.stringify(descriptor)});
    postMessage({ constructed, maximum: memory.maximum, instanceOfFallback: memory instanceof wasm.Memory && memory instanceof FakeMemory, error: null });
} catch (error) {
    postMessage({ constructed, maximum: null, instanceOfFallback: false, error: error.name });
}
`);
}

const ENGINE_MEMORY = { initial: 4096, maximum: 65536, shared: true };

describe('HyperDB memory fallback', () => {
    it('keeps the maximum that fits', async () => {
        expect(await constructWithFake(null, ENGINE_MEMORY)).toEqual({
            constructed: [65536],
            maximum: 65536,
            instanceOfFallback: true,
            error: null,
        });
    });

    it('halves the maximum until a memory fits', async () => {
        expect(await constructWithFake(20000, ENGINE_MEMORY)).toEqual({
            constructed: [65536, 32768, 16384],
            maximum: 16384,
            instanceOfFallback: true,
            error: null,
        });
    });

    it('fails once the maximum would fall below the initial size', async () => {
        expect(await constructWithFake(1000, ENGINE_MEMORY)).toEqual({
            constructed: [65536, 32768, 16384, 8192, 4096],
            maximum: null,
            instanceOfFallback: false,
            error: 'RangeError',
        });
    });

    it('passes the error of a memory without a maximum on', async () => {
        expect(await constructWithFake(0, { initial: 1 })).toEqual({
            constructed: [null],
            maximum: null,
            instanceOfFallback: false,
            error: 'RangeError',
        });
    });

    it('creates a real shared memory', async () => {
        const result = await runInWorker<{ isolated: boolean; memory: boolean; shared: boolean }>(`
${HYPERDB_MEMORY_FALLBACK_SOURCE}
const memory = new WebAssembly.Memory({ initial: 1, maximum: 16, shared: true });
postMessage({
    isolated: self.crossOriginIsolated,
    memory: memory instanceof WebAssembly.Memory,
    shared: typeof SharedArrayBuffer !== 'undefined' && memory.buffer instanceof SharedArrayBuffer,
});
`);
        expect(result.memory).toBe(true);
        expect(result.shared).toBe(result.isolated);
    });
});
