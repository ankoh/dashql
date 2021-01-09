import * as proto from "@dashql/proto";
import * as model from "../model";
import { ActionID } from "../model";
import { SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class DropVizActionLogic extends SetupActionLogic {
    constructor(action_id: ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async execute(context: ActionContext): Promise<ActionID> {
        const store = context.platform.store!;
        const objectId = this.buffer.objectId();
        model.mutate(store.dispatch, {
            type: model.StateMutationType.DELETE_PLAN_OBJECTS,
            data: [
                objectId
            ]
        });
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}
