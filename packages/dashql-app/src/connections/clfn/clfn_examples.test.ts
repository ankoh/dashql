import * as dashql from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { explainClientFunctionCall } from './clfn_runtime.js';
import { jsonPointerSegments, type ClientFunctionCallDescription } from './clfn_spec.js';
import { loadClientFunctionSpec } from './clfn_specs.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

/// A description as the runtime gets it, with values in place of its parameters
function withValues(description: ClientFunctionCallDescription): ClientFunctionCallDescription {
    const options = structuredClone(description.options);
    for (const { pointer, param } of description.bindings ?? []) {
        const path = jsonPointerSegments(pointer);
        const last = path.pop()!;
        const target = path.reduce<any>((value, segment) => value[segment], options);
        target[last] = `:${param}`;
    }
    return { ...description, options, bindings: undefined };
}

describe('The examples of the Data 360 client functions', () => {
    it('build a request of their function', async () => {
        const spec = await loadClientFunctionSpec('d360-api');
        const catalog = dql.createCatalog();
        catalog.registerClientFunctions(JSON.stringify(spec));
        const functions = spec.functions.filter(fn => fn.raw !== true);
        expect(functions.length).toBeGreaterThan(500);

        for (const fn of functions) {
            const script = dql.createScript(catalog);
            script.insertTextAt(0, fn.example!);
            script.analyze();
            const analyzed = script.getAnalyzed().read();
            expect(analyzed.clientFunctionCallsLength(), fn.example).toEqual(1);
            const description = JSON.parse(analyzed.clientFunctionCalls(0)!.description()!) as ClientFunctionCallDescription;
            expect(description.function, fn.example).toEqual(fn.name);

            const result = await explainClientFunctionCall(spec, withValues(description), { variables: () => ({ api_version: '68.0' }) });
            const field = (name: string) => result.rows[0][result.schema.fields.findIndex(f => f.name === name)];
            expect(field('method'), fn.example).toEqual(fn.method);
            expect(field('host'), fn.example).toEqual(fn.host);
            // The placeholders of the path and of the base path of its host are filled
            expect(field('path'), fn.example).not.toContain('{');
        }
    }, 60000);
});
