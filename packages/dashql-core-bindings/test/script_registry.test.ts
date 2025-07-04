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

describe('Script Registry Tests', () => {
    it('', () => {
        const catalog = dql!.createCatalog();

        const schema = dql!.createScript(catalog, 1);
        schema.insertTextAt(0, 'create table foo(a int);');
        schema.scan().delete();
        schema.parse().delete();
        schema.analyze().delete();

        const registry = dql!.createScriptRegistry();

        const target = dql!.createScript(catalog, 2);
        target.insertTextAt(0, 'select * from foo where a < 3');
        target.scan().delete();
        target.parse().delete();
        target.analyze().delete();

        registry.loadScript(target);

        registry.delete();
        catalog.delete();
        target.delete();
        schema.delete();
    })
});
