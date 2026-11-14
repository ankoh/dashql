import { checkWasmFeatures, UnsupportedRuntimeError, WASM_FEATURE_MODULES, WEB_ASSEMBLY, type RuntimeEnvironment } from './runtime_check.js';

type Feature = keyof typeof WASM_FEATURE_MODULES;

/// A runtime that supports the given features, and exnref once its flag is set
function fakeRuntime(supported: Feature[], exnrefWithFlag: boolean) {
    const flags: string[] = [];
    const env: RuntimeEnvironment = {
        validate: bytes => {
            const feature = (Object.keys(WASM_FEATURE_MODULES) as Feature[]).find(f => WASM_FEATURE_MODULES[f] === bytes);
            if (feature == null) throw new Error('unexpected module');
            if (feature === 'exnref' && exnrefWithFlag && flags.includes('--experimental-wasm-exnref')) return true;
            return supported.includes(feature);
        },
        setFlags: flag => flags.push(flag),
        execPath: '/opt/old/bin/node',
        version: 'v24.4.1',
    };
    return { env, flags };
}

describe('checkWasmFeatures', () => {
    it('passes a runtime with every feature and sets no flag', () => {
        const { env, flags } = fakeRuntime(['memory64', 'table64', 'exnref'], false);
        expect(() => checkWasmFeatures(env)).not.toThrow();
        expect(flags).toEqual([]);
    });

    it('turns on exnref with a V8 flag where Node 24 has it behind one', () => {
        const { env, flags } = fakeRuntime(['memory64', 'table64'], true);
        expect(() => checkWasmFeatures(env)).not.toThrow();
        expect(flags).toEqual(['--experimental-wasm-exnref']);
    });

    it('names the node, its version and the feature when the flag does not help', () => {
        const { env } = fakeRuntime(['memory64', 'table64'], false);
        const error = (() => {
            try {
                checkWasmFeatures(env);
            } catch (e) {
                return e;
            }
            return null;
        })();
        expect(error).toBeInstanceOf(UnsupportedRuntimeError);
        const message = (error as Error).message;
        expect(message).toContain('/opt/old/bin/node');
        expect(message).toContain('v24.4.1');
        expect(message).toContain('exnref');
        expect(message).not.toContain('memory64');
        expect((error as UnsupportedRuntimeError).missing).toEqual(['exnref']);
    });

    it('names every missing feature', () => {
        const { env } = fakeRuntime([], false);
        expect(() => checkWasmFeatures(env)).toThrow(UnsupportedRuntimeError);
        try {
            checkWasmFeatures(env);
        } catch (e) {
            expect((e as UnsupportedRuntimeError).missing).toEqual(['memory64', 'table64', 'exnref']);
        }
    });

    it('passes the node that runs the tests', () => {
        expect(() => checkWasmFeatures()).not.toThrow();
    });

    it('has modules that this node validates', () => {
        for (const bytes of Object.values(WASM_FEATURE_MODULES)) {
            expect(WEB_ASSEMBLY.validate(bytes)).toBe(true);
        }
    });
});
