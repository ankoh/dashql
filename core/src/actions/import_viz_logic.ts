import * as proto from "@dashql/proto";
import * as utils from "../utils";
import { ActionID } from "../model";
import { SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class ImportVizActionLogic extends SetupActionLogic {
    constructor(action_id: ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async execute(_context: ActionContext): Promise<ActionID> {
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}
