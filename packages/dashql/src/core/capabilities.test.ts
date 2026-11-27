import * as dashql from './index.js';

import { loadCoreWasm, testPlatform } from './test_fixture.js';

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});

afterEach(() => {
    dql.resetUnsafe();
});

const TEXT = `/** @vis table */
select * from t where amount > :min`;

/// The type and the message of the errors of a script analyzed with a catalog
function errorsOf(catalog: dashql.DashQLCatalog, text: string) {
    const script = dql.createScript(catalog);
    script.insertTextAt(0, text);
    script.analyze();
    const analyzed = script.getAnalyzed().read();
    const errors = [];
    for (let i = 0; i < analyzed.errorsLength(); ++i) {
        const error = analyzed.errors(i)!;
        errors.push({ type: error.errorType(), message: error.message() });
    }
    return { errors, visualizations: analyzed.visualizationSpecsLength() };
}

const DISABLED = dashql.buffers.analyzer.AnalyzerErrorType.DISABLED_CAPABILITY;

describe('Capabilities', () => {
    it('offers every extension by default', () => {
        expect(errorsOf(dql.createCatalog(), TEXT)).toEqual({ errors: [], visualizations: 1 });
    });

    it('flags the extensions that a catalog does not offer', () => {
        const catalog = dql.createCatalog();
        catalog.setCapabilities(['params']);
        expect(errorsOf(catalog, TEXT)).toEqual({
            errors: [{ type: DISABLED, message: '@vis is not available here, the tag is ignored' }],
            visualizations: 0,
        });
        catalog.setCapabilities([]);
        expect(errorsOf(catalog, TEXT).errors.map(e => e.message)).toEqual([
            'the parameter :min is not available here',
            '@vis is not available here, the tag is ignored',
        ]);
    });

    it('fails for an unknown capability', () => {
        const catalog = dql.createCatalog();
        expect(() => catalog.setCapabilities(['charts' as dashql.RuntimeCapability])).toThrow(/unknown capability "charts"/);
    });

    it('gives the connections of a runtime the capabilities of its settings', () => {
        const { platform } = testPlatform();
        const runtime = dql.createRuntime({ ...platform, settings: { capabilities: ['params', 'table_parameters'] } });
        runtime.runCatalogLoader(false);
        const created = runtime.dispatch('app', {
            kind: 'createConnection',
            value: { connectionId: 'main', connectorType: dashql.ConnectorType.HYPER, setupParams: { protocol: 'WASM', endpoint: '' } },
        });
        expect(created.ok).toBe(true);
        const catalog = dql.runtimeCatalog(runtime, 'main')!;
        expect(errorsOf(catalog, TEXT).errors.map(e => e.message)).toEqual(['@vis is not available here, the tag is ignored']);
        catalog.destroy();
        runtime.free();
    });

    it('refuses a runtime with an unknown capability', () => {
        const { platform } = testPlatform();
        expect(() => dql.createRuntime({ ...platform, settings: { capabilities: ['charts' as dashql.RuntimeCapability] } })).toThrow(
            /unknown capability "charts"/,
        );
    });
});
