import * as proto from "@dashql/proto";
import { ActionID, SetupAction } from "./action";
import { ActionContext } from "./action_context";

export class ImportTableAction extends SetupAction {
    constructor(action_id: ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async prepare(_context: ActionContext): Promise<ActionID> {
        return this._action_id;
    }

    public async execute(_context: ActionContext): Promise<ActionID> {
        return this._action_id;
    }

    public async teardown(_context: ActionContext): Promise<ActionID> {
        return this._action_id;
    }
}
