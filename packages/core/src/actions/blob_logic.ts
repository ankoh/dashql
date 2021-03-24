import * as proto from '@dashql/proto';
import { ActionHandle } from '../model';
import { SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export class ImportBlobActionLogic extends SetupActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepare(_context: ActionContext) {}
    public async execute(_context: ActionContext): Promise<void> {}
}

export class DropBlobActionLogic extends SetupActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepare(_context: ActionContext) {}
    public async execute(_context: ActionContext): Promise<void> {}
}
