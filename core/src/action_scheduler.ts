import * as proto from "@dashql/proto";
import { NativeBitmap, NativeStack, NativeMinHeap, NativeMinHeapKey, NativeMinHeapRank } from "./utils";
import { ActionLogic, ProtoAction, resolveSetupActionLogic, resolveProgramActionLogic } from "./actions";
import { ActionContext } from "./actions";
import { ActionID, Action, ActionClass, ActionUpdate, buildActionID, getActionIndex, StateMutationType } from './model';

export class ActionScheduler<ActionBuffer extends ProtoAction> {
    /// The cancel promise
    _interrupt: Promise<ActionID | null>;

    /// The actions
    _actions: ActionLogic<ActionBuffer>[] = [];
    /// The pending actions
    _actionQueue: NativeMinHeap = new NativeMinHeap();
    /// The action promises
    _actionPromises: Promise<ActionID | null>[] = [];
    /// The action promise mapping
    _actionPromiseMapping: (number | null)[] = [];

    /// The scheduled actions
    _scheduledActions: NativeBitmap = new NativeBitmap();
    /// The completed actions
    _completedActions: NativeBitmap = new NativeBitmap();
    /// The failed actions
    _failedActions: NativeBitmap = new NativeBitmap();

    constructor(interrupt: Promise<ActionID | null>) {
        this._interrupt = interrupt;
    }

    public prepare(actions: ActionLogic<ActionBuffer>[]) {
        this._actions = actions;
        this._actionPromises = [this._interrupt];
        this._actionPromiseMapping = [];

        // Build the dependency heap
        let deps: [NativeMinHeapKey, NativeMinHeapRank][] = [];
        deps.length = actions.length;
        for (let i = 0; i < actions.length; ++i) {
            deps[i] = [i, actions[i].buffer.dependsOnLength()];
            this._actionPromiseMapping.push(null);
        }
        deps.sort((l, r) => l[1] - r[1]);
        this._actionQueue.build(deps);

        // Build the status bitmaps
        this._scheduledActions.reset(this._actions.length);
        this._completedActions.reset(this._actions.length);
        this._failedActions.reset(this._actions.length);
    }

    /// Get the actions
    public get actions() { return this._actions; }
    /// Set the scheduler interrupt promise
    public set interrupt(promise: Promise<ActionID | null>) { this._interrupt = promise; }

    /// Is there work left?
    public workLeft(): boolean { return !this._scheduledActions.empty(); }
    /// Are no more actions scheduled?
    public noneScheduled(): boolean { return this._scheduledActions.empty(); }
    /// Are there failed actions?
    public someFailed(): boolean { return !this._failedActions.empty(); }
    /// Are all complete?
    public allComplete(): boolean { return this._completedActions.allSet(); }

    /// Schedule all actions that can be scheduled.
    /// An action can be scheduled if its rank is zero in the dependency heap.
    protected scheduleNext(context: ActionContext, diff: NativeStack) {
        while ((!this._actionQueue.empty()) && (this._actionQueue.topRank() == 0)) {
            const next_action_id = this._actionQueue.top();
            const next_action = this._actions[next_action_id];
            this._actionQueue.pop();
            this._scheduledActions.set(next_action_id);
            this._actionPromiseMapping[next_action_id] = this._actionPromises.length;
            this._actionPromises.push(next_action.execute(context));
            diff.push(next_action_id);
        }
    }

    /// Execute the first time.
    /// Returns true if execute should be called again.
    public async executeFirst(context: ActionContext, diff: NativeStack): Promise<boolean> {
        this.scheduleNext(context, diff);
        return this.execute(context, diff);
    }

    /// Waits until one of the currently running action promises resolves or rejects.
    /// Returns true if execute should be called again.
    public async execute(context: ActionContext, diff: NativeStack): Promise<boolean> {
        // Nothing to do?
        if (!this.workLeft()) return false;

        // Wait for next action to complete
        const next = await Promise.race(this._actionPromises);
        if (next == null) {
            /// Update interrupt promise since someone might have just replaced it.
            this._actionPromises[0] = this._interrupt;
            /// Return false to indicate that we're not yet done and let the graph scheduler figure out whats wrong.
            return true;
        }
        diff.push(next);

        // Remove action promise
        const action_idx = getActionIndex(next);
        this._actionPromises.splice(this._actionPromiseMapping[action_idx]!, 1);
        this._actionPromiseMapping[action_idx] = null;

        // Check the new status of the action
        switch (this._actions[action_idx].status) {
            case proto.action.ActionStatusCode.PREPARING:
            case proto.action.ActionStatusCode.BLOCKED:
            case proto.action.ActionStatusCode.RUNNING:
            case proto.action.ActionStatusCode.TEARDOWN:
                break;

            case proto.action.ActionStatusCode.COMPLETED:
                this._scheduledActions.clear(action_idx);
                this._completedActions.set(action_idx);
                for (const req of this._actions[action_idx].buffer.requiredForArray()!) {
                    this._actionQueue.decrementRank(req);
                }
                this.scheduleNext(context, diff);
                break;

            case proto.action.ActionStatusCode.NONE:
            case proto.action.ActionStatusCode.ERROR:
                this._scheduledActions.clear(action_idx);
                this._failedActions.set(action_idx);
                break;
        }

        // No more scheduled actions left?
        return !this.workLeft();
    }
}

export class ActionGraphScheduler {
    /// The cancel promise
    _interruptPromise: Promise<ActionID | null>;
    /// The cancel promise
    _interruptFunction: () => void;
    /// Has been canceled?
    _canceled: boolean;

    /// The setup actions
    _setupActions: ActionScheduler<proto.action.SetupAction>;
    /// The program actions
    _programActions: ActionScheduler<proto.action.ProgramAction>;

    /// Constructor
    constructor() {
        this._interruptFunction = () => {};
        this._interruptPromise = new Promise((resolve: (value: any) => void, _reject: (reason?: void) => void) => {
            this._interruptFunction = () => resolve(null);
        });
        this._canceled = false;
        this._setupActions = new ActionScheduler<proto.action.SetupAction>(this._interruptPromise);
        this._programActions = new ActionScheduler<proto.action.ProgramAction>(this._interruptPromise);
    }

    /// Reset the scheduler
    public prepare(ctx: ActionContext) {
        this._canceled = false;
        const program = ctx.plan.program!;
        const graph = ctx.plan.action_graph!;
        const now = new Date();

        // Translate the setup actions
        let actionInfos: Action[] = [];
        let setupLogic = [];
        for (let i = 0; i < graph.setupActionsLength(); ++i) {
            const actionId = buildActionID(i, ActionClass.SetupAction);
            const a = graph.setupActions(i)!;
            setupLogic.push(resolveSetupActionLogic(actionId, a)!);
            actionInfos.push({
                actionId: actionId,
                actionType: a.actionType(),
                statusCode: a.actionStatusCode(),
                blocker: null,
                dependsOn: a.dependsOnArray() || new Uint32Array(),
                requiredFor: a.requiredForArray() || new Uint32Array(),
                originStatement: null,
                objectId: a.objectId(),
                targetNameQualified: a.targetNameQualified() || "",
                targetNameShort: a.targetNameQualified() || "",
                script: null,
                timeCreated: now,
                timeScheduled: null,
                timeLastUpdate: now,
            });
        }
        this._setupActions.prepare(setupLogic);

        // Translate the program actions
        let programLogic = [];
        for (let i = 0; i < graph.programActionsLength(); ++i) {
            const actionId = buildActionID(i, ActionClass.ProgramAction);
            const a = graph.programActions(i)!;
            const s = program.getStatement(a.originStatement());
            programLogic.push(resolveProgramActionLogic(actionId, a, s)!);
            actionInfos.push({
                actionId: actionId,
                actionType: a.actionType(),
                statusCode: a.actionStatusCode(),
                blocker: null,
                dependsOn: a.dependsOnArray() || new Uint32Array(),
                requiredFor: a.requiredForArray() || new Uint32Array(),
                originStatement: a.originStatement(),
                objectId: a.objectId(),
                targetNameQualified: a.targetNameQualified() || "",
                targetNameShort: a.targetNameQualified() || "",
                script: a.script(),
                timeCreated: now,
                timeScheduled: null,
                timeLastUpdate: now,
            });
        }
        this._programActions.prepare(programLogic);

        // Set all actions in the store
        ctx.platform.state.dispatch({
            type: StateMutationType.SET_PLAN_ACTIONS,
            payload: actionInfos
        });
    }

    /// Interrupt the scheduler
    protected interrupt() {
        // Setup a new interrupt promise
        const prev_interrupt = this._interruptFunction;
        this._interruptFunction = () => {};
        this._interruptPromise = new Promise((resolve: (value: any) => void, _reject: (reason?: void) => void) => {
            this._interruptFunction = () => resolve(null);
        });
        this._setupActions.interrupt = this._interruptPromise;
        this._programActions.interrupt = this._interruptPromise;

        // Fire the interrupt
        prev_interrupt();
    }

    /// Cancel the scheduler
    public cancel() {
        this._canceled = true;
        this.interrupt();
    }

    /// Execute all exctions of a scheduler
    protected async executeActions<ActionBuffer extends ProtoAction>(ctx: ActionContext, diff: NativeStack, scheduler: ActionScheduler<ActionBuffer>) {
        const dispatch = ctx.platform.state.dispatch;
        for (let workLeft = await scheduler.executeFirst(ctx, diff); workLeft; diff.clear(),
                 workLeft = await scheduler.execute(ctx, diff)) {

            // Synchronize all the diffed actions
            let actionUpdates: ActionUpdate[] = [];
            for (;!diff.empty(); diff.pop()) {
                const actionId = diff.top();
                const action = scheduler.actions[getActionIndex(actionId)];
                actionUpdates.push({
                    actionId: actionId,
                    statusCode: action.status,
                    blocker: action.blocker,
                });
            }

            // Update all actions in the store
            dispatch({
                type: StateMutationType.UPDATE_PLAN_ACTIONS,
                payload: actionUpdates
            });
        }
    }

    /// Execute the entire action graph
    public async execute(ctx: ActionContext) {
        // Execute the actions
        const diff = new NativeStack(64);
        await this.executeActions(ctx, diff, this._setupActions);
        diff.clear();
        await this.executeActions(ctx, diff, this._programActions);
    }
};  
