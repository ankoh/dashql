import * as proto from "@dashql/proto";
import { Statement, Program } from "../model";

export class Action<ActionBuffer> {
    /// A protocol buffer
    _action: ActionBuffer;

    /// Constructor
    constructor(action: ActionBuffer) {
        this._action = action;
    }
}

export class ProgramAction extends Action<proto.action.ProgramAction> {
    /// The origin statement
    _origin: Statement;

    /// Constructor
    constructor(action: proto.action.ProgramAction, origin: Statement) {
        super(action);
        this._origin = origin;
    }
}

export class SetupAction extends Action<proto.action.SetupAction> {
    /// Constructor
    constructor(action: proto.action.SetupAction) {
        super(action);
    }
}
