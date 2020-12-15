import * as proto from "@dashql/proto";
import { Statement, Program } from "../model";

export class Action<ActionBuffer> {
    /// A protocol buffer
    _action: ActionBuffer;
    /// A program
    _program: Program;

    /// Constructor
    constructor(action: ActionBuffer, program: Program) {
        this._action = action;
        this._program = program;
    }
}

export class ProgramAction extends Action<proto.action.ProgramAction> {
    /// The origin statement
    _origin: Statement;

    /// Constructor
    constructor(action: proto.action.ProgramAction, program: Program, origin: Statement) {
        super(action, program);
        this._origin = origin;
    }
}

export class SetupAction extends Action<proto.action.SetupAction> {

    /// Constructor
    constructor(action: proto.action.SetupAction, program: Program) {
        super(action, program);
    }
}
