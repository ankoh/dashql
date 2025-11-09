import '@jest/globals';

import * as dashql from '../src/index.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create(DASHQL_PRECOMPILED);
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});


const DEFAULT_LAYOUT_CONFIG = (() => {
    const config = new dashql.buffers.view.PlanLayoutConfigT();
    config.levelHeight = 64.0;
    config.nodeHeight = 32.0;
    config.nodeMarginHorizontal = 20.0;
    config.nodePaddingLeft = 8.0;
    config.nodePaddingRight = 8.0;
    config.iconWidth = 14.0;
    config.iconMarginRight = 8.0;
    config.maxLabelChars = 20;
    config.widthPerLabelChar = 8.5;
    config.nodeMinWidth = 0;
    return config;
})();

describe('Plan View Model', () => {
    describe('Hyper Plans', () => {
        it('invalid json should throw', () => {
            const viewModel = dql!.createPlanViewModel(DEFAULT_LAYOUT_CONFIG);
            expect(() => viewModel.loadHyperPlan("notavalidjson")).toThrow();
        });
        it('null input', () => {
            const viewModel = dql!.createPlanViewModel(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan("null");
            expect(planPtr.read().operatorsLength()).toEqual(0);
        });
        it('empty json input', () => {
            const viewModel = dql!.createPlanViewModel(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan("{}");
            expect(planPtr.read().operatorsLength()).toEqual(0);
        });
        it('parse tablescan', () => {
            const viewModel = dql!.createPlanViewModel(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan(`
                {"operator":"executiontarget","operatorId":1,"cardinality":5,"producesRows":true,"output":[{"expression":"iuref","iu":["v",["Char",25]]}],"outputNames":["r_name"],"input":{"operator":"tablescan","operatorId":2,"sqlpos":[[41,47]],"cardinality":5,"relationId":9,"schema":{"type":"sessionschema"},"values":[{"name":"r_regionkey","type":["Integer"],"iu":null},{"name":"r_name","type":["Char",25],"iu":["v",["Char",25]]},{"name":"r_comment","type":["Varchar",152],"iu":null}],"debugName":{"classification":"nonsensitive","value":"region"},"selectivity":1}}
            `);
            const planReader = planPtr.read();
            expect(planReader.operatorsLength()).toEqual(2);
            expect(planReader.rootOperatorsLength()).toEqual(1);
            expect(planReader.rootOperators(0)).toEqual(1);
            expect(planReader.stringDictionary(planReader.operators(1)!.operatorTypeName())).toEqual("executiontarget");
            expect(planReader.stringDictionary(planReader.operators(0)!.operatorTypeName())).toEqual("tablescan");
        });
    });
});
