import * as proto from "@dashql/proto";
import * as webdb from "@dashql/webdb";
import * as model from "../model";
import { ProgramActionLogic, SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;
import { SVGStyleMap } from "../model";

export abstract class BaseVizActionLogic extends ProgramActionLogic {
    constructor(action_id: model.ActionID, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    protected getDefaultVizInfo(): model.VizInfo {
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
                    row: 0,
                    column: 0,
                    width: 0,
                    height: 0,
                },
                components: []
            }
        };
    }

    protected deriveVizInfo(context: ActionContext): model.VizInfo {
        const instance = context.plan.programInstance;
        const vizSpec = instance.vizSpecs.get(this.origin.statementId);
        if (!vizSpec) {
            return this.getDefaultVizInfo();
        }
        const now = new Date();

        // Read position
        const tmp = new webdb.Value();
        const posReader = vizSpec.position()!;
        const pos: model.VizPosition = {
            row: posReader.row(),
            column: posReader.column(),
            width: posReader.width(),
            height: posReader.height(),
        };

        // Read the component specs
        const components = new Array<model.VizComponentSpec>();
        for (let i = 0; i < vizSpec.componentsLength(); ++i) {
            const c = vizSpec.components(i)!;
            const dataReader = c.data();
            const data: model.VizData = {};
            if (dataReader) {
                data.x = instance.readNodeValueIfValid(dataReader.x())?.castAsString() || undefined;
                data.y = instance.readNodeValueIfValid(dataReader.y())?.castAsString() || undefined;
                data.y0 = instance.readNodeValueIfValid(dataReader.y0())?.castAsString() || undefined;
                data.categories = instance.readNodeValueIfValid(dataReader.y0())?.castAsString() || undefined;
            }
            const styles: SVGStyleMap = {};
            components.push({
                styles,
                data,
                selectionID: null
            });
        }

        return {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.VIZ_INFO,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this.buffer.targetNameQualified() || "",
            nameShort: this.buffer.targetNameShort() || "",
            currentStatementId: this.origin.statementId,
            spec: {
                position: pos,
                components: components
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
