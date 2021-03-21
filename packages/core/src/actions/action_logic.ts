import * as proto from '@dashql/proto';
import { ActionHandle, Statement, getActionClass, getActionIndex } from '../model';
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

export type ActionError = any;

export abstract class ActionLogic<ActionBuffer extends ProtoAction> {
    /// The action id
    _action_id: ActionHandle;
    /// The protocol buffer
    _action: ActionBuffer;
    /// The status
    _status: proto.action.ActionStatusCode;
    /// The blocker (if any)
    _blocker: proto.action.ActionBlocker | null = null;

    /// Constructor
    constructor(action_id: ActionHandle, action: ActionBuffer) {
        this._action_id = action_id;
        this._action = action;
        this._status = action.actionStatusCode();
    }

    /// Get the action id
    public get actionId() {
        return this._action_id;
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
    /// Set the action status
    public set status(status: proto.action.ActionStatusCode) {
        this._status = status;
    }
    /// Get the blocker
    public get blocker() {
        return this._blocker;
    }

    /// Prepare an action for execution
    public abstract prepare(context: ActionContext): void;
    /// Execute an action
    public abstract execute(context: ActionContext): Promise<void>;

    /// Prepare the execution guarded
    public prepareGuarded(context: ActionContext): ActionError | null {
        try {
            this._status = proto.action.ActionStatusCode.RUNNING;
            this.prepare(context);
            return null;
        } catch(e) {
            this._status = proto.action.ActionStatusCode.FAILED;
            return e;
        }
    }
    /// Execute the action guarded
    public async executeGuarded(context: ActionContext): Promise<[ActionHandle, ActionError | null]> {
        try {
            this._status = proto.action.ActionStatusCode.RUNNING;
            await this.execute(context);
            this._status = proto.action.ActionStatusCode.COMPLETED;
            return [this._action_id, null];
        } catch (e) {
            this._status = proto.action.ActionStatusCode.FAILED;
            return [this._action_id, e];
        }
    }
}

export abstract class ProgramActionLogic extends ActionLogic<proto.action.ProgramAction> {
    /// The origin statement
    _origin: Statement;

    /// Constructor
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, origin: Statement) {
        super(action_id, action);
        this._origin = origin;
        this._status = action.actionStatusCode();
    }

    /// Return the origin
    public get origin() { return this._origin; }
    /// Return the script
    public get script() { return this._action.script() || null; }
}

export abstract class SetupActionLogic extends ActionLogic<proto.action.SetupAction> {
    /// Constructor
    constructor(action_id: ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
        this._status = action.actionStatusCode();
    }
}
