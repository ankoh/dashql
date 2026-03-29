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

describe('DashQL scripts', () => {
    it('can be created', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        expect(script).not.toBeUndefined();
        script.destroy();
        catalog.destroy();
    });

    it('are initially empty', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        expect(script).not.toBeUndefined();
        expect(script.toString()).toEqual('');
        script.destroy();
        catalog.destroy();
    });

    it('should throw for accesses after deletion', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.destroy();
        catalog.destroy();
        expect(() => script.toString()).toThrow(dashql.NULL_POINTER_EXCEPTION);
        expect(() => script.insertTextAt(0, 'foo')).toThrow(dashql.NULL_POINTER_EXCEPTION);
        expect(() => script.eraseTextRange(0, 1)).toThrow(dashql.NULL_POINTER_EXCEPTION);
    });

    it('can be deleted repeatedly', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        expect(script).not.toBeUndefined();
        expect(script.toString()).toEqual('');
        script.destroy();
        script.destroy();
        script.destroy();
        catalog.destroy();
    });

    describe('text modifications', () => {
        it('inserting a single character', () => {
            const catalog = dql!.createCatalog();
            const script = dql!.createScript(catalog);
            script.insertTextAt(0, 'a');
            expect(script.toString()).toEqual('a');
            script.destroy();
            catalog.destroy();
        });
    });
});
