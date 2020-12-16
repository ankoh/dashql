import * as proto from "@dashql/proto";
import { NativeBitmap, TopologicalSort, TopoKey, TopoRank } from "./utils";
import { ActionID, Action, ProtoAction, translateSetupAction, translateProgramAction } from "./actions";
import { ActionContext } from "./actions";
import { Program } from './model';

export class ActionScheduler<ActionBuffer extends ProtoAction> {
    /// The actions
    _actions: Action<ActionBuffer>[];
    /// The pending actions
    _action_queue: TopologicalSort;
    /// The action promises
    _action_promises: Promise<ActionID>[];
    /// The action promise mapping
    _action_promise_mapping: (number | null)[];

    /// The scheduled actions
    _scheduled_actions: NativeBitmap;
    /// The completed actions
    _completed_actions: NativeBitmap;
    /// The failed actions
    _failed_actions: NativeBitmap;

    constructor(actions: Action<ActionBuffer>[]) {
        this._actions = actions;
        this._action_promises = [];
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

    protected schedule_next(context: ActionContext) {
        while ((!this._action_queue.empty()) && (this._action_queue.topRank() == 0)) {
            const next_action_id = this._action_queue.top();
            const next_action = this._actions[next_action_id];
            this._scheduled_actions.set(next_action_id);
            this._action_promise_mapping[next_action_id] = this._action_promises.length;
            this._action_promises.push(next_action.execute(context));
        }
    }

    async execute(context: ActionContext): Promise<boolean> {
        // Execute an action
        const action_id: ActionID = await Promise.race(this._action_promises);
        this._action_promises.splice(this._action_promise_mapping[action_id]!, 1);
        this._action_promise_mapping[action_id] = null;

        // Check the new status of the action
        switch (this._actions[action_id].status!.statusCode()) {
            case proto.action.ActionStatusCode.NONE:
                break;
            case proto.action.ActionStatusCode.PREPARING:
                break;
            case proto.action.ActionStatusCode.BLOCKED:
                break;
            case proto.action.ActionStatusCode.RUNNING:
                break;
            case proto.action.ActionStatusCode.TEARDOWN:
                break;
            case proto.action.ActionStatusCode.COMPLETED:
                this._scheduled_actions.clear(action_id);
                this._completed_actions.set(action_id);
                for (const req of this._actions[action_id].buffer.requiredForArray()!) {
                    this._action_queue.decrementKey(req, 1);
                }
                this.schedule_next(context);
                break;
            case proto.action.ActionStatusCode.ERROR:
                this._scheduled_actions.clear(action_id);
                this._failed_actions.set(action_id);
                break;
        }

        return Promise.resolve(true);
    }
}

export class ActionGraphScheduler {
    /// The setup actions
    _setup_actions: ActionScheduler<proto.action.SetupAction>;
    /// The program actions
    _program_actions: ActionScheduler<proto.action.ProgramAction>;

    /// Constructor
    constructor(program: Program, action_graph: proto.action.ActionGraph) {
        // Translate the setup actions
        let setup_actions = [];
        for (let i = 0; i < action_graph.setupActionsLength(); ++i) {
            const a = action_graph.setupActions(i)!;
            setup_actions.push(translateSetupAction(i, a)!);
        }
        this._setup_actions = new ActionScheduler<proto.action.SetupAction>(setup_actions);

        // Translate the program actions
        let program_actions = [];
        for (let i = 0; i < action_graph.programActionsLength(); ++i) {
            const a = action_graph.programActions(i)!;
            const s = program.getStatement(a.originStatement());
            program_actions.push(translateProgramAction(i, a, s)!);
        }
        this._program_actions = new ActionScheduler<proto.action.ProgramAction>(program_actions);
    }

    
};
