import * as proto from "@dashql/proto";
import { Statement } from "../model";
import { ActionContext } from "./action_context";

export abstract class Action<ActionBuffer> {
    /// The protocol buffer
    _action: ActionBuffer;

    /// Constructor
    constructor(action: ActionBuffer) {
        this._action = action;
    }

    /// Prepare an action
    abstract async prepare(context: ActionContext): Promise<proto.action.ActionStatusCode>;
    /// Execute an action
    abstract async execute(context: ActionContext): Promise<proto.action.ActionStatusCode>;
    /// Teardown an action
    abstract async teardown(context: ActionContext): Promise<proto.action.ActionStatusCode>;
}

export abstract class ProgramAction extends Action<proto.action.ProgramAction> {
    /// The origin statement
    _origin: Statement;

    /// Constructor
    constructor(action: proto.action.ProgramAction, origin: Statement) {
        super(action);
        this._origin = origin;
    }
}

export abstract class SetupAction extends Action<proto.action.SetupAction> {
    /// Constructor
    constructor(action: proto.action.SetupAction) {
        super(action);
    }
}
