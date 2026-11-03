import * as dashql from './index.js';
import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await loadCoreWasm();
    dql = await dashql.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});


const DEFAULT_LAYOUT_CONFIG = (() => {
    const config = new dashql.buffers.profile.ProfileLayoutConfigT();
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
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            expect(() => viewModel.loadHyperPlan("notavalidjson")).toThrow();
        });
        it('null input', () => {
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan("null");
            expect(planPtr.read().operatorsLength()).toEqual(0);
        });
        it('empty json input', () => {
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan("{}");
            expect(planPtr.read().operatorsLength()).toEqual(0);
        });
        it('parse tablescan', () => {
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan(`
                {"operator":"executiontarget","operatorId":1,"cardinality":5,"producesRows":true,"output":[{"expression":"iuref","iu":["v",["Char",25]]}],"outputNames":["r_name"],"input":{"operator":"tablescan","operatorId":2,"sqlpos":[[41,47]],"cardinality":5,"relationId":9,"schema":{"type":"sessionschema"},"values":[{"name":"r_regionkey","type":["Integer"],"iu":null},{"name":"r_name","type":["Char",25],"iu":["v",["Char",25]]},{"name":"r_comment","type":["Varchar",152],"iu":null}],"debugName":{"classification":"nonsensitive","value":"region"},"selectivity":1}}
            `);
            const planReader = planPtr.read();
            expect(planReader.operatorsLength()).toEqual(2);
            expect(planReader.rootOperatorsLength()).toEqual(1);
            expect(planReader.rootOperators(0)).toEqual(1);
            expect(planReader.pipelinesLength()).toEqual(0);
            expect(planReader.stringDictionary(planReader.operators(1)!.typeName())).toEqual("executiontarget");
            expect(planReader.stringDictionary(planReader.operators(0)!.typeName())).toEqual("tablescan");
            const tableScan = planReader.operators(0)!;
            const properties: Record<string, unknown> = {};
            for (let i = 0; i < tableScan.attributeCount(); ++i) {
                const attribute = planReader.attributes(tableScan.attributesBegin() + i)!;
                properties[planReader.stringDictionary(attribute.name())!] = JSON.parse(planReader.stringDictionary(attribute.valueJson())!);
            }
            expect(properties.operatorId).toEqual(2);
            expect(properties.relationId).toEqual(9);
            expect(properties.values).toHaveLength(3);
            expect(properties).not.toHaveProperty('debugName.input');
        });
        it('parses explicit pipeline membership', () => {
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan(`{
                "operator":"executiontarget","operatorId":1,
                "input":{"operator":"tablescan","operatorId":2},
                "pipelines":[{"pipelineId":10,"operators":[2,1]}]
            }`);
            const plan = planPtr.read();
            expect(plan.engine()).toEqual(dashql.buffers.profile.ProfileEngine.HYPER);
            expect(plan.pipelinesLength()).toEqual(1);
            const pipeline = plan.pipelines(0)!;
            expect(plan.stringDictionary(pipeline.engineId())).toEqual('10');
            expect(pipeline.slotCount()).toEqual(2);
            const scan = plan.slots(pipeline.slotsBegin())!;
            const target = plan.slots(pipeline.slotsBegin() + 1)!;
            expect([scan.operator(), scan.role()]).toEqual([0, dashql.buffers.profile.ProfileSlotRole.SOURCE]);
            expect([target.operator(), target.role()]).toEqual([1, dashql.buffers.profile.ProfileSlotRole.SINK]);
            const edge = plan.operatorEdges(0)!;
            expect([edge.child(), edge.parent(), edge.slot()]).toEqual([0, 1, pipeline.slotsBegin()]);
        });
        it('applies input events and returns the effective state', () => {
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            const plan = viewModel.loadHyperPlan(`{"operator":"output","input":{"operator":"scan"}}`);
            const version = plan.read().structureVersion();
            const events = viewModel.applyEvents(JSON.stringify([
                { type: 'registerFragment', time: 1, engineId: '0' },
                { type: 'registerPipeline', time: 1, fragment: 0, slots: [{ operator: 0, role: 'source' }, { operator: 1, role: 'sink' }] },
                { type: 'updateSlot', time: 2, slot: 0, status: 'running', stats: { tuplesOut: 5 } },
            ])).read();
            // Registering repacks the structure
            expect(events.structureVersion()).toEqual(version + 2);
            expect(viewModel.buffer!.read().structureVersion()).toEqual(version + 2);
            expect(viewModel.buffer!.read().slotsLength()).toEqual(2);

            const view = dashql.buffers.profile;
            const updates = Array.from({ length: events.eventsLength() }, (_, i) => events.events(i)!);
            const scan = updates.find(u => u.entity() === view.ProfileEntity.OPERATOR && u.index() === 0)!;
            expect(scan.status()).toEqual(view.ProfileExecutionStatus.RUNNING);
            expect(scan.stats().reported()).toEqual(view.ProfileStatsField.TUPLES_OUT);
            expect(scan.stats().tuplesOut()).toEqual(5n);

            // A late reader gets the same state as a snapshot
            const snapshot = viewModel.snapshotEvents().read();
            expect(snapshot.eventsLength()).toEqual(updates.length);
            expect(() => viewModel.applyEvents('[{"type":"updateSlot"}]')).toThrow();

            // Resetting drops the registered structure
            expect(viewModel.resetExecution().read().slotsLength()).toEqual(0);
            expect(viewModel.snapshotEvents().read().eventsLength()).toEqual(0);
        });
        it('follows the statement stats of a Trino query', () => {
            const view = dashql.buffers.profile;
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            expect(viewModel.startQuery(view.ProfileEngine.TRINO).read().fragmentsLength()).toEqual(0);
            const events = viewModel.applyTrinoStatementStats(JSON.stringify({
                state: 'RUNNING', completedSplits: 3, totalSplits: 10,
                rootStage: { stageId: '0', state: 'RUNNING', subStages: [{ stageId: '1', state: 'FINISHED' }] },
            }), 1000).read();
            // The stages are registered as fragments
            expect(viewModel.buffer!.read().fragmentsLength()).toEqual(2);
            expect(events.structureVersion()).toEqual(viewModel.buffer!.read().structureVersion());
            const updates = Array.from({ length: events.eventsLength() }, (_, i) => events.events(i)!);
            const query = updates.find(u => u.entity() === view.ProfileEntity.QUERY)!;
            expect(query.eventTime()).toEqual(1000n);
            expect([query.status(), query.stats()!.workDone(), query.stats()!.workTotal()]).toEqual([view.ProfileExecutionStatus.RUNNING, 3n, 10n]);
            expect(() => viewModel.applyTrinoStatementStats('{', 2000)).toThrow();
        });
        it('materializes operator cross edges', () => {
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan(`{
                "operator":"unionall","operatorId":1,"input":[
                    {"operator":"join","operatorId":2,"left":{"operator":"tablescan","operatorId":3}},
                    {"operator":"tablescan","operatorId":4,"earlyProbes":[
                        {"builder":2,"attributes":[0],"type":"lookup"}
                    ]}
                ]
            }`);
            const plan = planPtr.read();
            expect(plan.operatorCrossEdgesLength()).toEqual(1);
            const edge = plan.operatorCrossEdges(0)!;
            expect(plan.operators(edge.source())!.crossEdgeCount()).toEqual(1);
        });
        it('creates fragments from federate descendants', () => {
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan(`{
                "operator":"output",
                "inputs":[{
                    "operator":"federate",
                    "inputs":[{"operator":"map","input":{"operator":"scan"}}]
                }]
            }`);
            const plan = planPtr.read();
            expect(plan.fragmentsLength()).toEqual(1);
            const fragment = plan.fragments(0)!;
            expect(fragment.rootOperator()).toEqual(2);
            expect(fragment.hidden()).toEqual(0);
            expect(fragment.operatorCount()).toEqual(3);
            expect(plan.fragmentOperators(fragment.operatorsBegin())).toEqual(2);
            expect(plan.fragmentOperators(fragment.operatorsBegin() + 1)).toEqual(1);
            expect(plan.fragmentOperators(fragment.operatorsBegin() + 2)).toEqual(0);
        });
        it('anchors a root fragment at the execution target', () => {
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan(`{
                "operator":"executiontarget",
                "input":{"operator":"tablescan"}
            }`);
            const plan = planPtr.read();
            expect(plan.fragmentsLength()).toEqual(1);
            const fragment = plan.fragments(0)!;
            expect(fragment.rootOperator()).toEqual(1);
            expect(fragment.hidden()).toEqual(1);
            expect(fragment.operatorCount()).toEqual(2);
            expect(plan.fragmentOperators(fragment.operatorsBegin())).toEqual(1);
            expect(plan.fragmentOperators(fragment.operatorsBegin() + 1)).toEqual(0);
        });
        it('preserves estimated and analyzed output rows', () => {
            const viewModel = dql!.createQueryProfile(DEFAULT_LAYOUT_CONFIG);
            const planPtr = viewModel.loadHyperPlan(`{
                "operator":"executiontarget","cardinality":100,
                "input":{
                    "operator":"tablescan","estimated-rows":80,
                    "statistics":{"output-rows":0}
                }
            }`);
            const plan = planPtr.read();
            const scan = plan.operators(0)!;
            const target = plan.operators(1)!;
            expect(scan.estimatedRows()).toEqual(80);
            expect(target.estimatedRows()).toEqual(100);

            // The analyzed rows are the execution state, 0 rows are reported rows
            const view = dashql.buffers.profile;
            const snapshot = viewModel.snapshotEvents().read();
            const scanState = Array.from({ length: snapshot.eventsLength() }, (_, i) => snapshot.events(i)!)
                .find(u => u.entity() === view.ProfileEntity.OPERATOR && u.index() === 0)!;
            expect(scanState.stats().reported() & view.ProfileStatsField.TUPLES_OUT).not.toEqual(0);
            expect(scanState.stats().tuplesOut()).toEqual(0n);

            const properties: Record<string, unknown> = {};
            for (let i = 0; i < scan.attributeCount(); ++i) {
                const attribute = plan.attributes(scan.attributesBegin() + i)!;
                properties[plan.stringDictionary(attribute.name())!] = JSON.parse(plan.stringDictionary(attribute.valueJson())!);
            }
            expect(properties.statistics).toEqual({ 'output-rows': 0 });
        });
    });
});
