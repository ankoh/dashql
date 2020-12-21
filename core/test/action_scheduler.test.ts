import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS, model } from '../src/index_node';
import * as path from 'path';
import * as proto from '@dashql/proto';
import { flatbuffers } from 'flatbuffers';
import { PlatformMock } from './mocks';

import ActionStatus = proto.action.ActionStatusCode;
import ProgramAction = proto.action.ProgramAction;
import ProgramActionType = proto.action.ProgramActionType;
import SetupAction = proto.action.SetupAction;
import SetupActionType = proto.action.SetupActionType;

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, "../src/wasm/core_wasm_node.wasm"));
    await core.init();
});

/// Build a program action
function buildProgramAction(type: ProgramActionType, status: ActionStatus, dependsOn: number[], requiredFor: number[], originStmt: number, objectId: number, targetQualified: string, targetShort: string, script: string | null) {
    const builder = new flatbuffers.Builder(64 + 8 * dependsOn.length + 8 * requiredFor.length + targetQualified.length + targetShort.length);

    const targetQualifiedOfs = builder.createString(targetQualified);
    const targetShortOfs = builder.createString(targetShort);
    const scriptOfs = script ? builder.createString(script) : null;
    const dependsOnOfs = proto.action.ProgramAction.createDependsOnVector(builder, dependsOn);
    const requiredForOfs = proto.action.ProgramAction.createRequiredForVector(builder, requiredFor);

    ProgramAction.start(builder);
    ProgramAction.addActionType(builder, type);
    ProgramAction.addActionStatusCode(builder, status);
    ProgramAction.addDependsOn(builder, dependsOnOfs);
    ProgramAction.addRequiredFor(builder, requiredForOfs);
    ProgramAction.addOriginStatement(builder, originStmt);
    ProgramAction.addObjectId(builder, objectId);
    ProgramAction.addTargetNameQualified(builder, targetQualifiedOfs);
    ProgramAction.addTargetNameShort(builder, targetShortOfs);
    if (scriptOfs) ProgramAction.addScript(builder, scriptOfs);
    const actionOfs = SetupAction.end(builder);

    builder.finish(actionOfs);
    const actionBuffer = builder.dataBuffer();
    return ProgramAction.getRoot(actionBuffer);
}

describe('Action Scheduler', () => {
   describe('setup actions', () => {
   });

   describe('program actions', () => {

        test('hello world', async () => {
            const platformMock = new PlatformMock();
            const platform = platformMock.getInstance();

            const actions: ProgramAction[] = [
                buildProgramAction(ProgramActionType.LOAD_HTTP, ActionStatus.NONE, [], [], 0, 0, "foo", "foo", null)
            ];
        });
   });
});
