import * as proto from "@dashql/proto";
import { SetupAction } from "./action";
import { ActionContext } from "./action_context";

export class ImportViewAction extends SetupAction {
    constructor(action: proto.action.SetupAction) {
        super(action);
    }

    async prepare(_context: ActionContext): Promise<proto.action.ActionStatusCode> {
        return proto.action.ActionStatusCode.COMPLETED;
    }

    async execute(_context: ActionContext): Promise<proto.action.ActionStatusCode> {

        return proto.action.ActionStatusCode.COMPLETED;
    }

    async teardown(_context: ActionContext): Promise<proto.action.ActionStatusCode> {
        return proto.action.ActionStatusCode.COMPLETED;
    }
}
