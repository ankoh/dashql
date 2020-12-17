import * as proto from "@dashql/proto";
import { NativeBitmap, NativeStack, TopologicalSort, TopoKey, TopoRank } from "./utils";
import { ActionID, Action, ProtoAction, translateSetupAction, translateProgramAction } from "./actions";
import { ActionContext } from "./actions";
import { Program } from './model';

export class ActionScheduler<ActionBuffer extends ProtoAction> {
    /// The cancel promise
    _interrupt: Promise<ActionID | null>;

    /// The actions
    _actions: Action<ActionBuffer>[];
    /// The pending actions
    _action_queue: TopologicalSort;
    /// The action promises
    _action_promises: Promise<ActionID | null>[];
    /// The action promise mapping
    _action_promise_mapping: (number | null)[];

    /// The scheduled actions
    _scheduled_actions: NativeBitmap;
    /// The completed actions
    _completed_actions: NativeBitmap;
    /// The failed actions
    _failed_actions: NativeBitmap;

    constructor(interrupt: Promise<ActionID | null>, actions: Action<ActionBuffer>[]) {
        this._interrupt = interrupt;
        this._actions = actions;
        this._action_promises = [this._interrupt];
        this._action_promise_mapping = [];

        let deps: [TopoKey, TopoRank][] = [];
        deps.length += actions.length;
        for (let i = 0; i < actions.length; ++i) {
            deps[i] = [i, actions[i].buffer.dependsOnLength()];
            this._action_promise_mapping.push(null);
        }
        deps.sort((l, r) => l[1] - r[1]);
        this._action_queue = new TopologicalSort(deps);

        this._scheduled_actions = new NativeBitmap(this._actions.length);
        this._completed_actions = new NativeBitmap(this._actions.length);
        this._failed_actions = new NativeBitmap(this._actions.length);
    }

    public set interrupt(promise: Promise<ActionID | null>) {
        this._interrupt = promise;
    }

    /// Schedule all actions that can be scheduled.
    /// An action can be scheduled if its rank is zero in the dependency heap.
    protected schedule_next(context: ActionContext, diff: NativeStack) {
        while ((!this._action_queue.empty()) && (this._action_queue.topRank() == 0)) {
            const next_action_id = this._action_queue.top();
            const next_action = this._actions[next_action_id];
            this._scheduled_actions.set(next_action_id);
            this._action_promise_mapping[next_action_id] = this._action_promises.length;
            this._action_promises.push(next_action.execute(context));
            diff.push(next_action_id);
        }
    }

    /// Waits until one of the currently running action promises resolves or rejects.
    async execute(context: ActionContext, diff: NativeStack): Promise<boolean> {
        // Execute an action
        const action_id = await Promise.race(this._action_promises);
        if (action_id == null) {
            /// Update interrupt promise since someone might have just replaced it.
            this._action_promises[0] = this._interrupt;
            /// Return false to indicate that we're not yet done and let the graph scheduler figure out whats wrong.
            return false;
        }

        // Remove action promise
        this._action_promises.splice(this._action_promise_mapping[action_id]!, 1);
        this._action_promise_mapping[action_id] = null;
        diff.push(action_id);

        // Check the new status of the action
        switch (this._actions[action_id].status!.statusCode()) {
            case proto.action.ActionStatusCode.PREPARING:
            case proto.action.ActionStatusCode.BLOCKED:
            case proto.action.ActionStatusCode.RUNNING:
            case proto.action.ActionStatusCode.TEARDOWN:
                break;

            case proto.action.ActionStatusCode.COMPLETED:
                this._scheduled_actions.clear(action_id);
                this._completed_actions.set(action_id);
                for (const req of this._actions[action_id].buffer.requiredForArray()!) {
                    this._action_queue.decrementKey(req, 1);
                }
                this.schedule_next(context, diff);
                break;

            case proto.action.ActionStatusCode.NONE:
            case proto.action.ActionStatusCode.ERROR:
                this._scheduled_actions.clear(action_id);
                this._failed_actions.set(action_id);
                break;
        }

        // No more scheduled actions left?
        const done = this._scheduled_actions.isEmpty();
        return Promise.resolve(done);
    }
}

export class ActionGraphScheduler {
    /// The setup actions
    _setup_actions: ActionScheduler<proto.action.SetupAction>;
    /// The program actions
    _program_actions: ActionScheduler<proto.action.ProgramAction>;

    /// The cancel promise
    _interrupt_promise: Promise<ActionID | null>;
    /// The cancel promise
    _interrupt_function: () => void;
    /// Has been canceled?
    _canceled: boolean;

    /// Constructor
    constructor(program: Program, action_graph: proto.action.ActionGraph) {
        // Setup the scheduler canceling
        this._interrupt_function = () => {};
        this._interrupt_promise = new Promise((resolve: (value: any) => void, _reject: (reason?: void) => void) => {
            this._interrupt_function = () => resolve(null);
        });
        this._canceled = false;

        // Translate the setup actions
        let setup_actions = [];
        for (let i = 0; i < action_graph.setupActionsLength(); ++i) {
            const a = action_graph.setupActions(i)!;
            setup_actions.push(translateSetupAction(i, a)!);
        }
        this._setup_actions = new ActionScheduler<proto.action.SetupAction>(this._interrupt_promise, setup_actions);

        // Translate the program actions
        let program_actions = [];
        for (let i = 0; i < action_graph.programActionsLength(); ++i) {
            const a = action_graph.programActions(i)!;
            const s = program.getStatement(a.originStatement());
            program_actions.push(translateProgramAction(i, a, s)!);
        }
        this._program_actions = new ActionScheduler<proto.action.ProgramAction>(this._interrupt_promise, program_actions);
    }

    /// Interrupt the scheduler
    protected interrupt() {
        // Setup a new interrupt promise
        const prev_interrupt = this._interrupt_function;
        this._interrupt_function = () => {};
        this._interrupt_promise = new Promise((resolve: (value: any) => void, _reject: (reason?: void) => void) => {
            this._interrupt_function = () => resolve(null);
        });
        this._setup_actions.interrupt = this._interrupt_promise;
        this._program_actions.interrupt = this._interrupt_promise;

        // Fire the interrupt
        prev_interrupt();
    }

    /// Cancel the scheduler
    public cancel() {
        this._canceled = true;
        this.interrupt();
    }

    public async execute(context: ActionContext) {

        
    }
};
