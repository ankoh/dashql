import * as proto from '@dashql/proto';
import * as model from '../model';
import { ActionHandle, Statement, PlanObject } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export class TransformActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext, _planObjects: PlanObject[]): void {}
    public willExecute(_context: ActionContext): void {}

    public async execute(context: ActionContext): Promise<void> {
        const instance = context.plan.programInstance;
        const stmtId = this._origin.statementId;
        const transform = instance.loadStatements.get(stmtId);
        if (!transform) throw new Error(`missing information for load statement ${stmtId}`);
        // Find the loaded blob
        const state = context.platform.store.getState();
        const planState = state.core.planState;
        const blobName = transform.dataSource();
        const blobID = planState.blobsByName.get(blobName);
        if (blobID === undefined) throw new Error(`missing blob id for blob '${blobID}'`);
        const blob = planState.objects.get(blobID) as model.UniqueBlob;
        if (!blob) throw new Error(`blob '${blobName}' is not registered in duckdb`);

        console.log(blob);
    }
}
