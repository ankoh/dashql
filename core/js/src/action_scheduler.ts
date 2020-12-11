import { Action } from "./actions";
import { TopologicalSort, TopoKey, TopoRank } from "./utils";

export class ActionScheduler<DerivedAction extends Action> {
    /// The plan
    _actions: DerivedAction[];
    /// The pending actions
    _pending: TopologicalSort;

    /// Constructor
    constructor(actions: DerivedAction[]) {
        let deps: [TopoKey, TopoRank][] = [];
        deps.length = actions.length;
        for (let i = 0; i < actions.length; ++i) {
            // XXX
        }

        this._actions = actions;
        this._pending = new TopologicalSort([]);
    }
};
