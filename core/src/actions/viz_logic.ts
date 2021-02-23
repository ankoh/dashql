import * as proto from "@dashql/proto";
import * as model from "../model";
import { ProgramActionLogic, SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export abstract class BaseVizActionLogic extends ProgramActionLogic {
    constructor(action_id: model.ActionID, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    protected deriveVizInfo(context: ActionContext): model.VizInfo {
        const now = new Date();
        return {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.VIZ_INFO,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this.buffer.targetNameQualified() || "",
            nameShort: this.buffer.targetNameShort() || "",
            currentStatementId: this.origin.statementId,
            spec: {
                position: {
                    x: 0,
                    y: 0,
                    width: 8,
                    height: 4,
                },
                components: []
            }
        };
    }
}

export class CreateVizActionLogic extends BaseVizActionLogic {
    constructor(action_id: model.ActionID, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public async execute(context: ActionContext): Promise<model.ActionID> {
        const info = this.deriveVizInfo(context);
        const store = context.platform.store;
        model.mutate(store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [info]
        });
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};

export class UpdateVizActionLogic extends BaseVizActionLogic {
    constructor(action_id: model.ActionID, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public async execute(context: ActionContext): Promise<model.ActionID> {
        const info = this.deriveVizInfo(context);
        const store = context.platform.store;
        model.mutate(store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [info]
        });

        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};

export class DropVizActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async execute(context: ActionContext): Promise<model.ActionID> {
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

export class ImportVizActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async execute(_context: ActionContext): Promise<model.ActionID> {
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}
