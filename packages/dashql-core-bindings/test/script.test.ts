import '@jest/globals';

import * as dashql from '../src/index.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';

const distPath = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const wasmPath = path.resolve(distPath, './dashql.wasm');

let dql: dashql.DashQL | null = null;

beforeAll(async () => {
    dql = await dashql.DashQL.create(async (imports: WebAssembly.Imports) => {
        const buf = await fs.promises.readFile(wasmPath);
        return await WebAssembly.instantiate(buf, imports);
    });
    expect(dql).not.toBeNull();
});

describe('DashQL scripts', () => {
    it('can be created', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog, 1);
        expect(script).not.toBeUndefined();
        script.destroy();
        catalog.destroy();
    });

    it('are initially empty', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog, 1);
        expect(script).not.toBeUndefined();
        expect(script.toString()).toEqual('');
        script.destroy();
        catalog.destroy();
    });

    it('should throw for accesses after deletion', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog, 1);
        script.destroy();
        catalog.destroy();
        expect(() => script.toString()).toThrow(dashql.NULL_POINTER_EXCEPTION);
        expect(() => script.insertTextAt(0, 'foo')).toThrow(dashql.NULL_POINTER_EXCEPTION);
        expect(() => script.eraseTextRange(0, 1)).toThrow(dashql.NULL_POINTER_EXCEPTION);
    });

    it('can be deleted repeatedly', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog, 1);
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
            const script = dql!.createScript(catalog, 1);
            script.insertTextAt(0, 'a');
            expect(script.toString()).toEqual('a');
            script.destroy();
            catalog.destroy();
        });
    });
});
