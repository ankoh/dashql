import * as dashql from '@ankoh/dashql-core';
import { materializeProfileScene, PROFILE_OPERATOR_PORT_INPUT, PROFILE_OPERATOR_PORT_OUTPUT } from './profile_scene.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => core.resetUnsafe());

function createViewModel(orientation = dashql.buffers.profile.ProfileLayoutOrientation.TOP_DOWN) {
    const config = new dashql.buffers.profile.ProfileLayoutConfigT();
    config.orientation = orientation;
    config.nodeMarginVertical = 12;
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
    it('lays out a left-to-right plan with edges between the sides of the operators', () => {
        const plan = createViewModel(dashql.buffers.profile.ProfileLayoutOrientation.LEFT_TO_RIGHT).loadHyperPlan(`{
            "operator":"join","operatorId":1,"left":{"operator":"tablescan","operatorId":2},"right":{"operator":"tablescan","operatorId":3}
        }`);
        const scene = materializeProfileScene(plan);
        expect(scene.leftToRight).toEqual(true);
        const join = scene.operators.find(op => op.kind === dashql.buffers.profile.ProfileOperatorKind.JOIN)!;
        // The plan grows to the right and downwards from the root at the top left
        expect(join.rect.x - join.rect.width / 2).toBeCloseTo(0);
        expect(join.rect.y - join.rect.height / 2).toBeCloseTo(0);
        expect(scene.height).toBeCloseTo(2 * 32 + 12);
        for (const edge of scene.edges) {
            const child = scene.operators[edge.childOperator];
            const parent = scene.operators[edge.parentOperator];
            expect(child.rect.x).toBeGreaterThan(parent.rect.x);
            // The edge leaves the left side of the input and enters the right side of the parent
            expect(edge.path.startsWith(`M ${child.rect.x - child.rect.width / 2} ${child.rect.y}`)).toEqual(true);
            expect(edge.path.endsWith(`${parent.rect.x + parent.rect.width / 2} ${parent.rect.y}`)).toEqual(true);
        }
    });
    it('omits the root execution-target fragment', () => {
        const plan = createViewModel().loadHyperPlan(`{
            "operator":"executiontarget","input":{"operator":"tablescan"}
        }`);
        expect(materializeProfileScene(plan).fragments).toHaveLength(0);
    });
    it('draws the contour of a fragment around its own operators, not the ones of nested fragments', () => {
        const plan = createViewModel().loadHyperPlan(`{
            "operator":"federate","inputs":[{"operator":"map","input":{"operator":"federate","inputs":[{"operator":"scan"}]}}]
        }`);
        const fragments = materializeProfileScene(plan).fragments;
        expect(fragments.map(f => [...f.operatorIds].sort())).toEqual([[2, 3], [0, 1]]);
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
