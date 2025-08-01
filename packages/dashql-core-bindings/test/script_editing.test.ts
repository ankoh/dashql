import '@jest/globals';

import { cyrb128, xoshiro128ss } from './rand.js';
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

/// A type of an interaction
enum ScriptInteractionType {
    Insert,
    Remove,
}
/// A single user interaction
class ScriptInteraction {
    /// The foundations operation tyep
    type: ScriptInteractionType;
    /// The begin of the operation
    begin: number;
    /// The operation size
    count: number;

    constructor(type: ScriptInteractionType, begin: number, count: number) {
        this.type = type;
        this.begin = begin;
        this.count = count;
    }

    /// Apply the foundations operation to a string buffer
    public applyToText(buffer: string, data: string): string {
        switch (this.type) {
            case ScriptInteractionType.Insert:
                return buffer.substring(0, this.begin) + data.substring(0, this.count) + buffer.substring(this.begin);
            case ScriptInteractionType.Remove:
                return buffer.substring(0, this.begin) + buffer.substring(this.begin + this.count);
        }
    }
    /// Apply the foundations operation to a rope
    public applyToScript(script: dashql.DashQLScript, data: string) {
        switch (this.type) {
            case ScriptInteractionType.Insert:
                script.insertTextAt(this.begin, data.substring(0, this.count));
                break;
            case ScriptInteractionType.Remove:
                script.eraseTextRange(this.begin, this.count);
                break;
        }
    }
    /// Print the interaction as string
    public toString() {
        const name = this.type == ScriptInteractionType.Insert ? 'insert' : 'remove';
        return name + '(' + this.begin + ',' + this.count + ')';
    }
}

class ScriptInteractionGenerator {
    /// The seeded data generator
    rng: () => number;
    /// The current data source
    dataSource: string;
    /// The current buffer size
    currentBufferSize: number;

    private rand() {
        return Math.floor(this.rng() * 0xffffffff);
    }

    /// Constructor
    private constructor(seedNumber: number, maxBytes: number) {
        const seed = cyrb128(seedNumber);
        this.currentBufferSize = 0;
        this.dataSource = '';
        this.rng = xoshiro128ss(seed[0], seed[1], seed[2], seed[3]);
        for (let i = 0; i < maxBytes; ++i) {
            this.dataSource += String.fromCharCode(48 + (this.rand() % (57 - 48)));
        }
    }
    /// Generate the next edit
    private generateOne(): ScriptInteraction {
        const begin = this.currentBufferSize == 0 ? 0 : this.rand() % this.currentBufferSize;
        console.assert(begin <= this.currentBufferSize);
        if ((this.rand() & 0b1) == 0) {
            const count = this.rand() % this.dataSource.length;
            this.currentBufferSize += count;
            return new ScriptInteraction(ScriptInteractionType.Insert, begin, count);
        } else {
            const end = begin + (begin == this.currentBufferSize ? 0 : this.rand() % (this.currentBufferSize - begin));
            console.assert(end - begin <= this.currentBufferSize);
            this.currentBufferSize -= end - begin;
            return new ScriptInteraction(ScriptInteractionType.Remove, begin, end - begin);
        }
    }

    /// Generate multiple foundations operations
    public static generateMany(seed: number, n: number, maxBytes: number): [ScriptInteraction[], string] {
        const gen = new ScriptInteractionGenerator(seed, maxBytes);
        const out: ScriptInteraction[] = [];
        for (let i = 0; i < n; ++i) {
            out.push(gen.generateOne());
        }
        return [out, gen.dataSource];
    }
}

describe('DashQL editing fuzzer', () => {
    for (let seed = 0; seed < 100; ++seed) {
        it(`script editing sequence, seed=${seed}`, () => {
            const [ops, dataSource] = ScriptInteractionGenerator.generateMany(seed, 100, 100);
            const catalog = dql!.createCatalog();
            const script = dql!.createScript(catalog, 1);
            let expected = '';
            for (let i = 0; i < ops.length; ++i) {
                expected = ops[i].applyToText(expected, dataSource);
                ops[i].applyToScript(script, dataSource);
                const have = script.toString();
                expect(have).toEqual(expected);
            }
            script.destroy();
            catalog.destroy();
        });
    }
});
