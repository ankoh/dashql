import * as dashql from './index.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await dashql.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('DashQL setup', () => {
    it('instantiates WebAssembly module', async () => {
        expect(dql).not.toBeNull();
        expect(dql).not.toBeUndefined();
    });

    it('copies strings into shared Wasm memory without encoding into it directly', () => {
        const heap = new Uint8Array(new SharedArrayBuffer(64));
        const module = {
            HEAPU8: heap,
            memory: { buffer: heap.buffer },
            _dashql_malloc: () => 8,
            _dashql_free: vi.fn(),
        } as any;
        const api = new dashql.DashQL(module);
        const encoder = new TextEncoder();
        api.encoder = {
            encodeInto(source: string, destination: Uint8Array) {
                if (destination.buffer instanceof SharedArrayBuffer) {
                    throw new TypeError('The provided Uint8Array value must not be shared');
                }
                return encoder.encodeInto(source, destination);
            },
        } as TextEncoder;

        expect(api.copyString('shell')).toEqual([8, 5]);
        expect(Array.from(heap.subarray(8, 14))).toEqual([115, 104, 101, 108, 108, 0]);
    });

    it('copies strings from shared Wasm memory before decoding them', () => {
        const heap = new Uint8Array(new SharedArrayBuffer(64));
        heap.set(new TextEncoder().encode('shell'), 8);
        const api = new dashql.DashQL({
            HEAPU8: heap,
            memory: { buffer: heap.buffer },
        } as any);
        const decoder = new TextDecoder();
        api.decoder = {
            decode(input?: AllowSharedBufferSource) {
                if (ArrayBuffer.isView(input) && input.buffer instanceof SharedArrayBuffer) {
                    throw new TypeError('The provided ArrayBufferView value must not be shared');
                }
                return decoder.decode(input);
            },
        } as TextDecoder;

        expect(api.readString(8, 5)).toBe('shell');
    });
});

describe('ContextObjectChildID', () => {
    it('create child ids', () => {
        const parentId = dashql.ExternalObjectID.create(1234, 5678);
        const childId = dashql.ContextObjectChildID.create(parentId, 91011);
        expect(childId).not.toEqual(parentId);
        expect(dashql.ContextObjectChildID.getParent(childId)).toEqual(parentId);
        expect(dashql.ContextObjectChildID.getChild(childId)).toEqual(91011);
        expect(childId.toString()).toEqual("22763282211344411091843");
    });
});
