import * as proto from "@dashql/proto";
import * as model from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class CreateVizActionLogic extends ProgramActionLogic {
    constructor(action_id: model.ActionID, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public async execute(context: ActionContext): Promise<model.ActionID> {

        const now = new Date();
        const viz: model.VizInfo = {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.VIZ_INFO,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this.buffer.targetNameQualified() || "",
            nameShort: this.buffer.targetNameShort() || "",
            spec: {
                type: model.VizSpecType.TABLE,
                data: {
                    position: {
                        x: 0,
                        y: 0,
                        width: 8,
                        height: 4
                    }
                }
            }
        };

        const store = context.platform.store;
        model.mutate(store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [viz]
        });

        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};
