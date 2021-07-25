import * as proto from '@dashql/proto';
import { ActionHandle, Statement, UniqueBlob } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

interface TransformOptions {
    expression?: string;
}

export class TransformActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}

    public async execute(context: ActionContext): Promise<void> {
        const instance = context.plan.programInstance;
        const stmtId = this._origin.statementId;
        const transform = instance.transformStatements.get(stmtId);
        if (!transform) throw new Error(`missing information for transform statement ${stmtId}`);

        // Find the loaded blob
        const state = context.platform.store.getState();
        const planState = state.core.planState;
        const blobName = transform.dataSource();
        const blobID = planState.blobsByName.get(blobName);
        console.log(blobName);
        console.log(blobID);
        console.log(planState.blobsByName);

        // Parse transform options
        const options = JSON.parse(transform.options()) as TransformOptions;
        console.log(options);

        // Evaluate a jmespath
        const blob = planState.objects.get(blobID) as UniqueBlob;
        const buffer = new Uint8Array(await blob.blob.arrayBuffer());
        const jp = await context.platform.resolveJMESPath();
        const result = await jp.evaluateUTF8(options.expression || '.', buffer);

        console.log(result);
    }
}
