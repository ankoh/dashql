import * as proto from '@dashql/proto';
import { ActionHandle, PlanObject, Statement } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export class ExtractActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext, _planObjects: PlanObject[]): void {}
    public willExecute(_context: ActionContext): void {}

    public async execute(context: ActionContext): Promise<void> {
        const instance = context.plan.programInstance;
        const stmtId = this._origin.statementId;
        const xtr = instance.extractStatements.get(stmtId);
        if (!xtr) {
            console.log(`missing information for extract statement ${stmtId}`);
            return;
        }

        console.log(`extract method: ${proto.syntax.ExtractMethodType[xtr.method()].toString()}`);
        console.log(`extraction indirection: ${xtr.targetIndirection()}`);
    }
}