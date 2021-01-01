import * as proto from '@dashql/proto';
import { NativeBitmap, NativeStack, NativeMinHeap, NativeMinHeapKey, NativeMinHeapRank } from './utils';
import { ActionLogic, ProtoAction, resolveSetupActionLogic, resolveProgramActionLogic } from './actions';
import { ActionContext } from './actions';
import { Platform } from './platform';
import {
    ActionID,
    Action,
    ActionClass,
    ActionUpdate,
    buildActionID,
    getActionIndex,
    StateMutationType,
    mutate,
    Plan,
} from './model';

export class ActionScheduler<ActionBuffer extends ProtoAction> {
    /// The cancel promise
    _interrupt: Promise<ActionID | null>;

    /// The actions
    _actions: ActionLogic<ActionBuffer>[] = [];
    /// The pending actions
    _actionQueue: NativeMinHeap = new NativeMinHeap();
    /// The action promises
    _actionPromises: (Promise<ActionID | null> | null)[] = [];

    /// The scheduled actions
    _scheduledActions: NativeBitmap = new NativeBitmap();
    /// The completed actions
    _completedActions: NativeBitmap = new NativeBitmap();
    /// The failed actions
    _failedActions: NativeBitmap = new NativeBitmap();

    constructor(interrupt: Promise<ActionID | null>) {
        this._interrupt = interrupt;
    }

    /// Get the scheduled actions
    public get scheduled() {
        return this._scheduledActions;
    }

    /// Prepare the scheduler
    public prepare(actions: ActionLogic<ActionBuffer>[]) {
        this._actions = actions;
        this._actionPromises = [];

        // Build the dependency heap
        let deps: [NativeMinHeapKey, NativeMinHeapRank][] = [];
        deps.length = actions.length;
        for (let i = 0; i < actions.length; ++i) {
            deps[i] = [i, actions[i].buffer.dependsOnLength()];
            this._actionPromises.push(null);
        }
        deps.sort((l, r) => l[1] - r[1]);
        this._actionQueue.build(deps);

        // Build the status bitmaps
        this._scheduledActions.reset(this._actions.length);
        this._completedActions.reset(this._actions.length);
        this._failedActions.reset(this._actions.length);
    }

    /// Get the actions
    public get actions() {
        return this._actions;
    }
    /// Set the scheduler interrupt promise
    public set interrupt(promise: Promise<ActionID | null>) {
        this._interrupt = promise;
    }

    /// Is there work left?
    public workLeft(): boolean {
        return !this._scheduledActions.empty();
    }
    /// Are no more actions scheduled?
    public noneScheduled(): boolean {
        return this._scheduledActions.empty();
    }
    /// Are there failed actions?
    public someFailed(): boolean {
        return !this._failedActions.empty();
    }
    /// Are all complete?
    public allComplete(): boolean {
        return this._completedActions.allSet();
    }

    /// Schedule all actions that can be scheduled.
    /// An action can be scheduled if its rank is zero in the dependency heap.
    protected scheduleNext(context: ActionContext, diff: NativeStack) {
        while (!this._actionQueue.empty() && this._actionQueue.topRank() == 0) {
            const next_action_idx = this._actionQueue.top();
            const next_action = this._actions[next_action_idx];
            this._actionQueue.pop();
            this._scheduledActions.set(next_action_idx);
            this._actionPromises[next_action_idx] = next_action.execute(context);
            diff.push(next_action_idx);
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
        let promises: Promise<ActionID | null>[] = [this._interrupt];
        this._actionPromises.forEach(p => {
            if (p) promises.push(p);
        });
        const next = await Promise.race(promises);
        if (next == null) {
            /// Update interrupt promise since someone might have just replaced it.
            this._actionPromises[0] = this._interrupt;
            /// Return false to indicate that we're not yet done and let the graph scheduler figure out whats wrong.
            return true;
        }
        diff.push(getActionIndex(next));

        // Check the new status of the action
        const action_idx = getActionIndex(next);
        this._actionPromises[action_idx] = null;
        switch (this._actions[action_idx].status) {
            case proto.action.ActionStatusCode.PREPARING:
            case proto.action.ActionStatusCode.BLOCKED:
            case proto.action.ActionStatusCode.RUNNING:
            case proto.action.ActionStatusCode.TEARDOWN:
                break;

            case proto.action.ActionStatusCode.COMPLETED: {
                this._scheduledActions.clear(action_idx);
                this._completedActions.set(action_idx);
                const requiredFor = this._actions[action_idx].buffer.requiredForArray();
                if (requiredFor) {
                    for (const req of requiredFor) {
                        this._actionQueue.decrementRank(req);
                    }
                    this.scheduleNext(context, diff);
                }
                break;
            }
            case proto.action.ActionStatusCode.NONE:
            case proto.action.ActionStatusCode.ERROR:
                this._scheduledActions.clear(action_idx);
                this._failedActions.set(action_idx);
                break;
        }

        // No more scheduled actions left?
        return this.workLeft();
    }
}

export class ActionGraphScheduler {
    /// The platform
    _platform: Platform;
    /// The plan (if any)
    _plan: Plan | null;

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
    constructor(platform: Platform) {
        this._platform = platform;
        this._plan = null;
        this._interruptFunction = () => {};
        this._interruptPromise = new Promise((resolve: (value: any) => void, _reject: (reason?: void) => void) => {
            this._interruptFunction = () => resolve(null);
        });
        this._canceled = false;
        this._setupActions = new ActionScheduler<proto.action.SetupAction>(this._interruptPromise);
        this._programActions = new ActionScheduler<proto.action.ProgramAction>(this._interruptPromise);
    }

    /// Reset the scheduler
    public prepare(plan: Plan): Action[] {
        this._canceled = false;
        this._plan = plan;
        const program = plan.program!;
        const graph = plan.action_graph!;
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
                targetNameQualified: a.targetNameQualified() || '',
                targetNameShort: a.targetNameQualified() || '',
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
                targetNameQualified: a.targetNameQualified() || '',
                targetNameShort: a.targetNameQualified() || '',
                script: a.script(),
                timeCreated: now,
                timeScheduled: null,
                timeLastUpdate: now,
            });
        }
        this._programActions.prepare(programLogic);
        return actionInfos;
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
    protected async executeActions<ActionBuffer extends ProtoAction>(
        ctx: ActionContext,
        diff: NativeStack,
        scheduler: ActionScheduler<ActionBuffer>
    ) {
        for (
            let workLeft = await scheduler.executeFirst(ctx, diff);
            workLeft;
            diff.clear(), workLeft = await scheduler.execute(ctx, diff)
        ) {
            // Synchronize all the diffed actions
            let actionUpdates: ActionUpdate[] = [];
            for (; !diff.empty(); diff.pop()) {
                const actionIdx = diff.top();
                const action = scheduler.actions[actionIdx];
                actionUpdates.push({
                    actionId: action.actionId,
                    statusCode: action.status,
                    blocker: action.blocker,
                });
            }

            // Update all actions in the store
            mutate(ctx.platform.store.dispatch, {
                type: StateMutationType.UPDATE_PLAN_ACTIONS,
                data: actionUpdates,
            });
        }
    }

    /// Execute the entire action graph
    public async execute() {
        if (this._plan == null) return;
        const ctx = new ActionContext(this._platform, this._plan);
        const diff = new NativeStack(64);
        await this.executeActions(ctx, diff, this._setupActions);
        diff.clear();
        await this.executeActions(ctx, diff, this._programActions);
    }
}
