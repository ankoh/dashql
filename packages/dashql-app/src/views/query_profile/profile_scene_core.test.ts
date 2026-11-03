import * as dashql from '@ankoh/dashql-core';
import { materializeProfileScene, PROFILE_OPERATOR_PORT_INPUT, PROFILE_OPERATOR_PORT_OUTPUT } from './profile_scene.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => core.resetUnsafe());

function createViewModel() {
    const config = new dashql.buffers.profile.ProfileLayoutConfigT();
    config.levelHeight = 64;
    config.nodeHeight = 32;
    config.nodeMarginHorizontal = 20;
    config.nodePaddingLeft = 8;
    config.nodePaddingRight = 8;
    config.iconWidth = 14;
    config.iconMarginRight = 8;
    config.maxLabelChars = 20;
    config.widthPerLabelChar = 8.5;
    return core.createQueryProfile(config);
}

describe('Core plan scene integration', () => {
    it('materializes operator cross edges and their ports', () => {
        const plan = createViewModel().loadHyperPlan(`{
            "operator":"unionall","operatorId":1,"input":[
                {"operator":"join","operatorId":2,"left":{"operator":"tablescan","operatorId":3}},
                {"operator":"tablescan","operatorId":4,"earlyProbes":[
                    {"builder":2,"attributes":[0],"type":"lookup"}
                ]}
            ]
        }`);
        const scene = materializeProfileScene(plan);
        const edge = scene.crossEdges[0];
        expect(edge.kind).toEqual('early-probe');
        expect(edge.properties).toMatchObject({ type: 'lookup', attributes: [0] });
        expect(edge.path).not.toEqual('');
        expect(scene.operators[edge.sourceOperator].ports & PROFILE_OPERATOR_PORT_OUTPUT).toBeTruthy();
        expect(scene.operators[edge.targetOperator].ports & PROFILE_OPERATOR_PORT_INPUT).toBeTruthy();
        for (const treeEdge of scene.edges) {
            expect(scene.operators[treeEdge.childOperator].ports & PROFILE_OPERATOR_PORT_OUTPUT).toBeTruthy();
            expect(scene.operators[treeEdge.parentOperator].ports & PROFILE_OPERATOR_PORT_INPUT).toBeTruthy();
        }
    });
    it('omits the root execution-target fragment', () => {
        const plan = createViewModel().loadHyperPlan(`{
            "operator":"executiontarget","input":{"operator":"tablescan"}
        }`);
        expect(materializeProfileScene(plan).fragments).toHaveLength(0);
    });
    it('encloses nested fragments in the contour of their parent', () => {
        const plan = createViewModel().loadHyperPlan(`{
            "operator":"federate","inputs":[{"operator":"map","input":{"operator":"federate","inputs":[{"operator":"scan"}]}}]
        }`);
        const fragments = materializeProfileScene(plan).fragments;
        expect(fragments.map(f => [...f.operatorIds].sort())).toEqual([[0, 1, 2, 3], [0, 1]]);
    });
    it('carries edges by the slots of their children', () => {
        const plan = createViewModel().loadHyperPlan(`{
            "operator":"executiontarget","operatorId":1,
            "input":{"operator":"tablescan","operatorId":2},
            "pipelines":[{"pipelineId":10,"operators":[2,1]}]
        }`);
        const scene = materializeProfileScene(plan);
        expect(scene.edges.map(e => e.slot)).toEqual([0]);
        expect(scene.pipelines[0].operatorIds).toEqual([0, 1]);
        expect(scene.operators[0].kind).toEqual(dashql.buffers.profile.ProfileOperatorKind.SCAN);
    });
});
