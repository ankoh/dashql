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

describe('DashQL Completion', () => {
    describe('single script prefix', () => {
        const test = (text: string, cursor_offset: number, expected: string[]) => {
            const catalog = dql!.createCatalog();
            const script = dql!.createScript(catalog, 1);
            script.insertTextAt(0, text);
            script.analyze();
            script.moveCursor(cursor_offset).destroy();

            const completionBuffer = script.completeAtCursor(10);
            const completion = completionBuffer.read();

            const candidates: string[] = [];
            for (let i = 0; i < completion.candidatesLength(); ++i) {
                const candidate = completion.candidates(i)!;
                candidates.push(candidate.completionText()!);
            }
            expect(candidates).toEqual(expected);

            script.destroy();
            catalog.destroy();
        };

        it('s', () => test('s', 1, ['select', 'set', 'values', 'with', 'create', 'table']));
    });
});
