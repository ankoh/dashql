import * as proto from '@dashql/proto';
import { NativeBitmap, NativeStack, NativeMinHeap, NativeMinHeapKey, NativeMinHeapRank } from './utils';
import { ActionLogic, ProtoAction, resolveSetupActionLogic, resolveProgramActionLogic } from './actions';
import { ActionContext, ActionError } from './actions';
import { Platform } from './platform';
import {
    ActionHandle,
    Action,
    ActionUpdate,
    PlanObject,
    buildActionHandle,
    getActionIndex,
    StateMutationType,
    mutate,
    Plan,
    getActionClass,
    LogLevel,
    LogOrigin,
    LogTopic,
    LogEvent,
} from './model';
import * as model from './model';

export class ActionScheduler<ActionBuffer extends ProtoAction> {
    /// The cancel promise.
    /// Resolves to [null, null].
    _interrupt: Promise<[ActionHandle | null, ActionError | null]>;

    /// The actions
    _actions: ActionLogic<ActionBuffer>[] = [];
    /// The pending actions
    _actionQueue: NativeMinHeap = new NativeMinHeap();
    /// The action promises
    _actionPromises: (Promise<[ActionHandle, ActionError | null]> | null)[] = [];

    /// The scheduled actions
    _scheduledActions: NativeBitmap = new NativeBitmap();
    /// The completed actions
    _completedActions: NativeBitmap = new NativeBitmap();
    /// The failed actions
    _failedActions: NativeBitmap = new NativeBitmap();

    /// Callback to store the action updates
    _storeActionUpdates: (logic: ActionUpdate[]) => void;

    constructor(interrupt: Promise<void>, storeActionUpdates: (logic: ActionUpdate[]) => void) {
        this._interrupt = interrupt.then(() => [null, null]);
        this._storeActionUpdates = storeActionUpdates;
    }

    /// Get the scheduled actions
    public get scheduled() {
        return this._scheduledActions;
    }

    /// Prepare the scheduler
    public prepare(ctx: ActionContext, actions: ActionLogic<ActionBuffer>[]) {
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

        // Prepare all actions
        let objects: model.PlanObject[] = [];
        actions.forEach((a, i) => a.prepare(ctx, objects));
        model.mutate(ctx.platform.store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: objects,
        });
    }

    /// Get the actions
    public get actions() {
        return this._actions;
    }
    /// Set the scheduler interrupt promise
    public set interrupt(interrupt: Promise<void>) {
        this._interrupt = interrupt.then(() => [null, null]);
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
        // Collect next actions
        let next_action_idcs: number[] = [];
        while (!this._actionQueue.empty() && this._actionQueue.topRank() == 0) {
            const action_idx = this._actionQueue.top();
            this._actionQueue.pop();
            diff.push(action_idx);

            // Action already done, register as completed?
            if (this._actions[action_idx].status == proto.action.ActionStatusCode.COMPLETED) {
                const requiredFor = this._actions[action_idx].buffer.requiredForArray();
                if (requiredFor) {
                    for (const req of requiredFor) {
                        this._actionQueue.decrementRank(req);
                    }
                }
                continue;
            }
            // Remember next action id
            next_action_idcs.push(action_idx);
        }

        // Prepare all actions for execution
        const logger = context.platform.logger;
        for (let i = 0; i < next_action_idcs.length; ++i) {
            const next_action_idx = next_action_idcs[i];
            const next_action = this._actions[next_action_idx];
            const err = next_action.willExecuteGuarded(context);
            if (err != null) {
                next_action_idcs[i] = -1;
                logger.log({
                    timestamp: new Date(),
                    level: LogLevel.WARNING,
                    origin: LogOrigin.ACTION_SCHEDULER,
                    topic: LogTopic.PREPARE_ACTION,
                    event: LogEvent.ERROR,
                    value: err,
                });
            }
        }
        // Schedule all actions
        for (const next_action_idx of next_action_idcs) {
            // Fiailed to prepare?
            if (next_action_idx == -1) continue;
            // Set action status to running
            const next_action = this._actions[next_action_idx];
            next_action.status = proto.action.ActionStatusCode.RUNNING;
            this._scheduledActions.set(next_action_idx);
            // Execute the action
            this._actionPromises[next_action_idx] = next_action.executeGuarded(context);
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

        // Flush any action updates
        this.flushActionUpdates(context, diff);

        // Wait for next action to complete
        let promises: Promise<[ActionHandle | null, ActionError | null]>[] = [this._interrupt];
        this._actionPromises.forEach(p => {
            if (p) promises.push(p);
        });

        let [next, err] = await Promise.race(promises);
        if (next == null) {
            /// Return true to indicate that we're not yet done and let the graph scheduler figure out whats wrong.
            return true;
        }
        diff.push(getActionIndex(next));

        // Check the new status of the action
        const action_idx = getActionIndex(next);
        this._actionPromises[action_idx] = null;
        switch (this._actions[action_idx].status) {
            case proto.action.ActionStatusCode.BLOCKED:
            case proto.action.ActionStatusCode.RUNNING:
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
            case proto.action.ActionStatusCode.FAILED:
                this._scheduledActions.clear(action_idx);
                this._failedActions.set(action_idx);
                break;
        }

        // Did the action fail?
        // Log the error
        if (err != null) {
            context.platform.logger.log({
                timestamp: new Date(),
                level: LogLevel.WARNING,
                origin: LogOrigin.ACTION_SCHEDULER,
                topic: LogTopic.EXECUTE_ACTION,
                event: LogEvent.ERROR,
                value: err,
            });
        }

        // Flush any action updates
        this.flushActionUpdates(context, diff);
        // No more scheduled actions left?
        return this.workLeft();
    }

    /// Flush teh action updates
    public flushActionUpdates(_ctx: ActionContext, diff: NativeStack) {
        if (diff.empty()) return;

        // Synchronize all actions in the diff
        let actionUpdates: Map<number, ActionUpdate> = new Map();
        for (; !diff.empty(); diff.pop()) {
            const actionIdx = diff.top();
            const action = this.actions[actionIdx];
            // Only propagate the most recent one
            if (actionUpdates.get(action.actionId)) continue;
            // Mark the action as updated
            actionUpdates.set(action.actionId, {
                actionId: action.actionId,
                statusCode: action.status,
                blocker: action.blocker,
            });
        }
        this._storeActionUpdates(Array.from(actionUpdates, ([_k, v]) => v));
    }
}

export class ActionGraphScheduler {
    /// The platform
    _platform: Platform;
    /// The plan (if any)
    _plan: Plan | null;

    /// The cancel promise
    _interruptPromise: Promise<void>;
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
        this._interruptPromise = new Promise((resolve: () => void, _reject: (reason?: void) => void) => {
            this._interruptFunction = () => resolve();
        });
        this._canceled = false;

        // Setup the schedulers
        const storeActionUpdates = this.storeActionUpdates.bind(this);
        this._setupActions = new ActionScheduler<proto.action.SetupAction>(this._interruptPromise, storeActionUpdates);
        this._programActions = new ActionScheduler<proto.action.ProgramAction>(
            this._interruptPromise,
            storeActionUpdates,
        );
    }

    /// Update the action status in redux and wasm
    protected storeActionUpdates(actionUpdates: ActionUpdate[]) {
        // Update the action status in the analyzer
        for (const u of actionUpdates) {
            // Update the action status in the analyzer
            this._platform.analyzer.updateActionStatus(
                getActionClass(u.actionId),
                getActionIndex(u.actionId),
                u.statusCode,
            );
        }
        // Update all actions in the store
        mutate(this._platform.store.dispatch, {
            type: StateMutationType.UPDATE_PLAN_ACTIONS,
            data: actionUpdates,
        });
    }

    /// Reset the scheduler
    public prepare(ctx: ActionContext) {
        this._canceled = false;
        this._plan = ctx.plan;
        const program = ctx.plan.program!;
        const graph = ctx.plan.action_graph!;
        const now = new Date();

        // Translate the setup actions
        let planObjects: PlanObject[] = [];
        let actionInfos: Action[] = [];
        let setupLogic = [];
        for (let i = 0; i < graph.setupActionsLength(); ++i) {
            const actionId = buildActionHandle(i, proto.action.ActionClass.SETUP_ACTION);
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

        // Translate the program actions
        let programLogic = [];
        for (let i = 0; i < graph.programActionsLength(); ++i) {
            const actionId = buildActionHandle(i, proto.action.ActionClass.PROGRAM_ACTION);
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

        mutate(ctx.platform.store.dispatch, {
            type: model.StateMutationType.SCHEDULE_PLAN,
            data: [ctx.plan, actionInfos],
        });
        this._setupActions.prepare(ctx, setupLogic);
        this._programActions.prepare(ctx, programLogic);

        // Prepare all actions
        for (const action of setupLogic) {
            action.prepare(ctx, planObjects);
        }
        for (const action of programLogic) {
            action.prepare(ctx, planObjects);
        }
        mutate(ctx.platform.store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: planObjects,
        });
    }

    /// Interrupt the scheduler
    protected interrupt() {
        // Setup a new interrupt promise
        const prev_interrupt = this._interruptFunction;
        this._interruptFunction = () => {};
        this._interruptPromise = new Promise((resolve: () => void, _reject: (reason?: void) => void) => {
            this._interruptFunction = () => resolve();
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
        scheduler: ActionScheduler<ActionBuffer>,
    ) {
        for (
            let workLeft = await scheduler.executeFirst(ctx, diff);
            workLeft;
            workLeft = await scheduler.execute(ctx, diff)
        ) {}
    }

    /// Execute the entire action graph
    public async execute(ctx: ActionContext) {
        if (this._plan == null) return;
        const diff = new NativeStack(64);
        await this.executeActions(ctx, diff, this._setupActions);
        diff.clear();
        await this.executeActions(ctx, diff, this._programActions);
    }
}
