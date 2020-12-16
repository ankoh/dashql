import * as proto from "@dashql/proto";
import { ActionID, SetupAction } from "./action";
import { ActionContext } from "./action_context";

export class ImportBlobAction extends SetupAction {
    constructor(action_id: ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async prepare(_context: ActionContext): Promise<proto.action.ActionStatusCode> {
        return proto.action.ActionStatusCode.NONE;
    }

    public async execute(_context: ActionContext): Promise<proto.action.ActionStatusCode> {
        return proto.action.ActionStatusCode.NONE;
    }

    public async teardown(_context: ActionContext): Promise<proto.action.ActionStatusCode> {
        return proto.action.ActionStatusCode.NONE;
    }
}
