import * as proto from '@dashql/proto';
import { ActionID, Statement, getActionClass, getActionIndex } from '../model';
import { ActionContext } from './action_context';

export interface ProtoAction {
    actionStatusCode(): proto.action.ActionStatusCode;

    dependsOn(index: number): number | null;
    dependsOnLength(): number;
    dependsOnArray(): Uint32Array | null;
    requiredFor(index: number): number | null;
    requiredForLength(): number;
    requiredForArray(): Uint32Array | null;

    objectId(): number;
    mutate_object_id(value: number): boolean;

    targetNameQualified(): string | null;
    targetNameShort(): string | null;
}

export abstract class ActionLogic<ActionBuffer extends ProtoAction> {
    /// The action id
    _action_id: ActionID;
    /// The protocol buffer
    _action: ActionBuffer;
    /// The status
    _status: proto.action.ActionStatusCode;
    /// The blocker (if any)
    _blocker: proto.action.ActionBlocker | null = null;

    /// Constructor
    constructor(action_id: ActionID, action: ActionBuffer) {
        this._action_id = action_id;
        this._action = action;
        this._status = action.actionStatusCode();
    }

    /// Get the action class
    public get actionClass() {
        return getActionClass(this._action_id);
    }
    /// Get the action index
    public get actionIndex() {
        return getActionIndex(this._action_id);
    }
    /// Get the flatbuffer
    public get buffer() {
        return this._action;
    }
    /// Get the status
    public get status() {
        return this._status;
    }
    /// Get the blocker
    public get blocker() {
        return this._blocker;
    }

    /// Return with a status
    protected returnWithStatus(status: proto.action.ActionStatusCode): ActionID {
        this._status = status;
        return this._action_id;
    }
    /// Execute an action
    public abstract execute(context: ActionContext): Promise<ActionID>;
}

export abstract class ProgramActionLogic extends ActionLogic<proto.action.ProgramAction> {
    /// The origin statement
    _origin: Statement;

    /// Constructor
    constructor(action_id: ActionID, action: proto.action.ProgramAction, origin: Statement) {
        super(action_id, action);
        this._origin = origin;
    }
}

export abstract class SetupActionLogic extends ActionLogic<proto.action.SetupAction> {
    /// Constructor
    constructor(action_id: ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }
}
