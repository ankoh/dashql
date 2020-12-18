import * as proto from "@dashql/proto";
import { NativeBitmap, NativeStack, TopologicalSort, TopoKey, TopoRank } from "./utils";
import { ActionID, ActionLogic, ProtoAction, resolveSetupActionLogic, resolveProgramActionLogic } from "./actions";
import { ActionContext } from "./actions";
import { Program } from './model';

export class ActionScheduler<ActionBuffer extends ProtoAction> {
    /// The cancel promise
    _interrupt: Promise<ActionID | null>;

    /// The actions
    _actions: ActionLogic<ActionBuffer>[];
    /// The pending actions
    _actionQueue: TopologicalSort;
    /// The action promises
    _actionPromises: Promise<ActionID | null>[];
    /// The action promise mapping
    _actionPromiseMapping: (number | null)[];

    /// The scheduled actions
    _scheduledActions: NativeBitmap;
    /// The completed actions
    _completedActions: NativeBitmap;
    /// The failed actions
    _failedActions: NativeBitmap;

    /// First actions scheduled?
    _firstScheduled: boolean;

    constructor(interrupt: Promise<ActionID | null>, actions: ActionLogic<ActionBuffer>[]) {
        this._interrupt = interrupt;
        this._actions = actions;
        this._actionPromises = [this._interrupt];
        this._actionPromiseMapping = [];

        // Build the dependency heap
        let deps: [TopoKey, TopoRank][] = [];
        deps.length += actions.length;
        for (let i = 0; i < actions.length; ++i) {
            deps[i] = [i, actions[i].buffer.dependsOnLength()];
            this._actionPromiseMapping.push(null);
        }
        deps.sort((l, r) => l[1] - r[1]);
        this._actionQueue = new TopologicalSort(deps);

        // Build the status bitmaps
        this._scheduledActions = new NativeBitmap(this._actions.length);
        this._completedActions = new NativeBitmap(this._actions.length);
        this._failedActions = new NativeBitmap(this._actions.length);

        // Remember that we havent scheduled the very first actions yet
        this._firstScheduled = false;
    }

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
        const action_id = await Promise.race(this._actionPromises);
        if (action_id == null) {
            /// Update interrupt promise since someone might have just replaced it.
            this._actionPromises[0] = this._interrupt;
            /// Return false to indicate that we're not yet done and let the graph scheduler figure out whats wrong.
            return true;
        }

        // Remove action promise
        this._actionPromises.splice(this._actionPromiseMapping[action_id]!, 1);
        this._actionPromiseMapping[action_id] = null;
        diff.push(action_id);

        // Check the new status of the action
        switch (this._actions[action_id].status) {
            case proto.action.ActionStatusCode.PREPARING:
            case proto.action.ActionStatusCode.BLOCKED:
            case proto.action.ActionStatusCode.RUNNING:
            case proto.action.ActionStatusCode.TEARDOWN:
                break;

            case proto.action.ActionStatusCode.COMPLETED:
                this._scheduledActions.clear(action_id);
                this._completedActions.set(action_id);
                for (const req of this._actions[action_id].buffer.requiredForArray()!) {
                    this._actionQueue.decrementKey(req, 1);
                }
                this.scheduleNext(context, diff);
                break;

            case proto.action.ActionStatusCode.NONE:
            case proto.action.ActionStatusCode.ERROR:
                this._scheduledActions.clear(action_id);
                this._failedActions.set(action_id);
                break;
        }

        // No more scheduled actions left?
        return Promise.resolve(!this.workLeft());
    }
}

export class ActionGraphScheduler {
    /// The setup actions
    _setupActions: ActionScheduler<proto.action.SetupAction>;
    /// The program actions
    _programActions: ActionScheduler<proto.action.ProgramAction>;

    /// The cancel promise
    _interruptPromise: Promise<ActionID | null>;
    /// The cancel promise
    _interruptFunction: () => void;
    /// Has been canceled?
    _canceled: boolean;

    /// Constructor
    constructor(program: Program, action_graph: proto.action.ActionGraph) {
        // Setup the scheduler canceling
        this._interruptFunction = () => {};
        this._interruptPromise = new Promise((resolve: (value: any) => void, _reject: (reason?: void) => void) => {
            this._interruptFunction = () => resolve(null);
        });
        this._canceled = false;

        // Translate the setup actions
        let setupActions = [];
        for (let i = 0; i < action_graph.setupActionsLength(); ++i) {
            const a = action_graph.setupActions(i)!;
            setupActions.push(resolveSetupActionLogic(i, a)!);
        }
        this._setupActions = new ActionScheduler<proto.action.SetupAction>(this._interruptPromise, setupActions);

        // Translate the program actions
        let programActions = [];
        for (let i = 0; i < action_graph.programActionsLength(); ++i) {
            const a = action_graph.programActions(i)!;
            const s = program.getStatement(a.originStatement());
            programActions.push(resolveProgramActionLogic(i, a, s)!);
        }
        this._programActions = new ActionScheduler<proto.action.ProgramAction>(this._interruptPromise, programActions);
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

    public async execute(ctx: ActionContext) {
        // Setup actions
        let diff = new NativeStack(64);
        for (let workLeft = await this._setupActions.executeFirst(ctx, diff); workLeft; diff.clear(),
                 workLeft = await this._setupActions.execute(ctx, diff)) {
        }

        // Program actions
        diff.clear();
        for (let workLeft = await this._programActions.executeFirst(ctx, diff); workLeft; diff.clear(),
                 workLeft = await this._programActions.execute(ctx, diff)) {

        }
    }
};
