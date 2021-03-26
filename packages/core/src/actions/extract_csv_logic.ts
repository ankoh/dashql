import * as proto from '@dashql/proto';
import { ActionHandle, PlanObject, Statement } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export class ExtractCSVActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext, _planObjects: PlanObject[]): void {}
    public willExecute(_context: ActionContext) {}
    public async execute(_context: ActionContext): Promise<void> {}
}
