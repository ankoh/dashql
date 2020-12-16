import * as proto from "@dashql/proto";
import { Statement } from "../model";
import { ActionContext } from "./action_context";

export type ActionID = number;

export interface ProtoAction {
    actionStatus(obj?: proto.action.ActionStatus): proto.action.ActionStatus|null;

    dependsOn(index: number): number | null;
    dependsOnLength(): number;
    dependsOnArray():Uint32Array | null;
    requiredFor(index: number): number | null;
    requiredForLength(): number;
    requiredForArray():Uint32Array | null;

    objectId(): number;
    mutate_object_id(value: number): boolean;

    targetNameQualified(): string | null;
    targetNameShort(): string | null;
}

export abstract class Action<ActionBuffer extends ProtoAction> {
    /// The action id
    _action_id: ActionID;
    /// The protocol buffer
    _action: ActionBuffer;
    /// The last update
    _last_update: Date;

    /// Constructor
    constructor(action_id: ActionID, action: ActionBuffer) {
        this._action_id = action_id;
        this._action = action;
        this._last_update = new Date();
    }

    /// Get the flatbuffer
    public get buffer() { return this._action; }
    /// Get the status
    public get status() { return this._action.actionStatus(); }

    /// Prepare an action
    public abstract prepare(context: ActionContext): Promise<proto.action.ActionStatusCode>;
    /// Execute an action
    public abstract execute(context: ActionContext): Promise<proto.action.ActionStatusCode>;
    /// Teardown an action
    public abstract teardown(context: ActionContext): Promise<proto.action.ActionStatusCode>;
}

export abstract class ProgramAction extends Action<proto.action.ProgramAction> {
    /// The origin statement
    _origin: Statement;

    /// Constructor
    constructor(action_id: ActionID, action: proto.action.ProgramAction, origin: Statement) {
        super(action_id, action);
        this._origin = origin;
    }
}

export abstract class SetupAction extends Action<proto.action.SetupAction> {
    /// Constructor
    constructor(action_id: ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }
}
