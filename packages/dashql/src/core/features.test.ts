import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

// The features of the core module under test: a module built with a feature has its classes, one without lacks them and
// says so. The projects of vitest.config.mjs run the tests of the bindings on the module with all features and on the
// module without features, each says which features it has.
const BUILT_WITH = new Set((process.env.DASHQL_CORE_FEATURES ?? '').split(',').filter(feature => feature !== ''));
const FEATURES: dashql.DashQLFeature[] = ['shell'];

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});

describe('the features of the core module', () => {
    it.each(FEATURES)('has the classes of %s exactly if it was built with it', feature => {
        expect(dql!.hasFeature(feature)).toBe(BUILT_WITH.has(feature));
        if (BUILT_WITH.has(feature)) {
            expect(dql!.feature(feature)).toBeTypeOf('function');
        } else {
            expect(() => dql!.feature(feature)).toThrow(`the core module was built without the feature ${feature}`);
        }
    });

    it('parses and analyzes a script with any features', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        try {
            script.replaceText('select 1');
            expect(script.toString()).toBe('select 1');
        } finally {
            script.destroy();
            catalog.destroy();
        }
    });
});
