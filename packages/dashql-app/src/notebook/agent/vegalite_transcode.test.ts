import * as core from '../../core/index.js';

import { VisSource, visSourceToData } from './agent_run_driver.js';
import { verifyScript } from './agent_verify.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await core.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(() => {
    dql!.resetUnsafe();
});

/// Transcode a spec object via the WASM core, injecting the given source as the `data` member.
function transcode(spec: Record<string, unknown>, source: VisSource): string {
    const data = visSourceToData(source);
    const merged = data != null ? { ...spec, data } : spec;
    return dql!.parseVegaLiteToVisualize(JSON.stringify(merged));
}

const TABLE_SOURCE: VisSource = { kind: 'table-reference', table: 'sales' };

describe('parseVegaLiteToVisualize (WASM)', () => {
    it('emits a minimal bar chart', () => {
        const dsl = transcode(
            {
                mark: 'bar',
                encoding: {
                    x: { field: 'category', type: 'nominal' },
                    y: { field: 'amount', type: 'quantitative' },
                },
            },
            TABLE_SOURCE,
        );
        expect(dsl).toContain('VISUALIZE sales AS');
        expect(dsl).toContain('mark => bar');
        expect(dsl).toContain('x => (field => category, type => nominal)');
        expect(dsl).toContain('y => (field => amount, type => quantitative)');
    });

    it('accepts an object-form mark', () => {
        const dsl = transcode(
            { mark: { type: 'line' }, encoding: { x: { field: 'ts', type: 'temporal' } } },
            TABLE_SOURCE,
        );
        expect(dsl).toContain('mark => line');
    });

    it('single-quotes string values and keeps numbers/booleans bare', () => {
        const dsl = transcode(
            {
                mark: 'bar',
                title: 'My Chart',
                width: 320,
                encoding: {
                    x: {
                        field: 'category',
                        type: 'nominal',
                        axis: { labelAngle: -45, format: '%Y' },
                        scale: { zero: false },
                    },
                },
            },
            TABLE_SOURCE,
        );
        expect(dsl).toContain("title => 'My Chart'");
        expect(dsl).toContain('width => 320');
        expect(dsl).toContain('label_angle => -45');
        expect(dsl).toContain("format => '%Y'");
        expect(dsl).toContain('zero => false');
    });

    it('maps camelCase keys to snake_case DSL keys', () => {
        const dsl = transcode(
            {
                mark: 'point',
                encoding: {
                    x: { field: 'ts', type: 'temporal', timeUnit: 'month' },
                    fillOpacity: { field: 'w', type: 'quantitative' },
                    y: { field: 'v', type: 'quantitative', scale: { type: 'log', paddingInner: 0.2 } },
                },
            },
            TABLE_SOURCE,
        );
        expect(dsl).toContain('time_unit => month');
        expect(dsl).toContain('fill_opacity =>');
        expect(dsl).toContain('scale => (type => log, padding_inner => 0.2)');
    });

    it('emits bin as a bare boolean or a param object', () => {
        const boolBin = transcode(
            { mark: 'bar', encoding: { x: { field: 'a', type: 'quantitative', bin: true } } },
            TABLE_SOURCE,
        );
        expect(boolBin).toContain('bin => true');

        const objBin = transcode(
            { mark: 'bar', encoding: { x: { field: 'a', type: 'quantitative', bin: { maxbins: 10 } } } },
            TABLE_SOURCE,
        );
        expect(objBin).toContain('bin => (maxbins => 10)');
    });

    it('emits arrays bare with quoted string elements', () => {
        const dsl = transcode(
            {
                mark: 'bar',
                encoding: {
                    y: { field: 'v', type: 'quantitative', scale: { domain: [0, 100] } },
                    color: { field: 'c', type: 'nominal', scale: { domain: ['a', 'b'] } },
                },
            },
            TABLE_SOURCE,
        );
        expect(dsl).toContain('domain => [0, 100]');
        expect(dsl).toContain("domain => ['a', 'b']");
    });

    it('drops unsupported keys and unknown channels', () => {
        const dsl = transcode(
            {
                mark: 'bar',
                config: { background: 'red' },
                encoding: {
                    x: { field: 'a', type: 'nominal', unknownProp: 1 },
                    bogusChannel: { field: 'b', type: 'nominal' },
                },
            },
            TABLE_SOURCE,
        );
        expect(dsl).not.toContain('config');
        expect(dsl).not.toContain('unknownProp');
        expect(dsl).not.toContain('bogusChannel');
    });

    it('quotes non-simple field identifiers', () => {
        const dsl = transcode(
            { mark: 'bar', encoding: { x: { field: 'has space', type: 'nominal' } } },
            TABLE_SOURCE,
        );
        expect(dsl).toContain('field => "has space"');
    });

    it('emits a script-reference source', () => {
        const dsl = transcode(
            { mark: 'bar', encoding: { x: { field: 'a', type: 'nominal' } } },
            { kind: 'script-reference', folderName: 'main', fileName: 'sales.sql' },
        );
        expect(dsl).toContain('VISUALIZE dashql.notebook."main/sales.sql" AS');
    });

    it('emits an inline-select source', () => {
        const dsl = transcode(
            { mark: 'bar', encoding: { x: { field: 'a', type: 'nominal' } } },
            { kind: 'inline-select', sql: 'SELECT a FROM t' },
        );
        expect(dsl).toContain('VISUALIZE (SELECT a FROM t) AS');
    });

    it('returns an empty string for malformed JSON', () => {
        expect(dql!.parseVegaLiteToVisualize('not json')).toBe('');
    });
});

describe('visSourceToData', () => {
    it('encodes a qualified table reference as a $ref path', () => {
        expect(visSourceToData({ kind: 'table-reference', database: 'db', schema: 's', table: 't' }))
            .toEqual({ $ref: ['db', 's', 't'] });
    });
    it('encodes a raw source verbatim', () => {
        expect(visSourceToData({ kind: 'raw', text: 'sales' })).toEqual({ $raw: 'sales' });
    });
    it('returns null for none', () => {
        expect(visSourceToData({ kind: 'none' })).toBeNull();
    });
});

/// Parse + analyze the transcoded DSL against a catalog seeded with the given source table,
/// using the same scratch-script verifier the agent loop uses.
function verifyAgainstSource(sourceSql: string, visText: string) {
    const catalog = dql!.createCatalog();
    const sourceScript = dql!.createScript(catalog);
    try {
        sourceScript.replaceText(sourceSql);
        sourceScript.analyze();
        catalog.loadScript(sourceScript, 0);
        return verifyScript(dql!, catalog, visText);
    } finally {
        sourceScript.destroy();
        catalog.destroy();
    }
}

describe('parseVegaLiteToVisualize round-trip', () => {
    it('produces DSL that parses + analyzes cleanly against a table reference', () => {
        const dsl = transcode(
            {
                mark: 'bar',
                encoding: {
                    x: { field: 'category', type: 'nominal' },
                    y: { field: 'amount', type: 'quantitative', aggregate: 'sum' },
                },
            },
            { kind: 'table-reference', table: 'sales' },
        );
        const r = verifyAgainstSource('create table sales(category text, amount int);', dsl);
        expect(r.parserErrors).toEqual([]);
        expect(r.analyzerErrors).toEqual([]);
        expect(r.visualizationSpecs).toBeGreaterThan(0);
    });

    it('produces DSL with scale/axis/title that parses + analyzes cleanly', () => {
        const dsl = transcode(
            {
                mark: 'line',
                title: 'Revenue',
                width: 400,
                height: 200,
                encoding: {
                    x: { field: 'ts', type: 'temporal', timeUnit: 'month', axis: { labelAngle: -45 } },
                    y: { field: 'amount', type: 'quantitative', scale: { type: 'linear', zero: false } },
                },
            },
            { kind: 'table-reference', table: 'sales' },
        );
        const r = verifyAgainstSource('create table sales(ts timestamp, amount int);', dsl);
        expect(r.parserErrors).toEqual([]);
        expect(r.analyzerErrors).toEqual([]);
        expect(r.visualizationSpecs).toBeGreaterThan(0);
    });
});
