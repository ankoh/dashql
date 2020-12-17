import * as proto from "@dashql/proto";
import { ActionID, SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";

export class DropViewActionLogic extends SetupActionLogic {
    constructor(action_id: ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async execute(_context: ActionContext): Promise<ActionID> {
        return this._action_id;
    }
}
