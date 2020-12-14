import * as proto from "@dashql/proto";
import { TopologicalSort, TopoKey, TopoRank } from "./utils";
import { SetupAction, ProgramAction } from "./actions";
import { Program } from './model';

export class ActionScheduler {
    /// The program
    _program: Program;
    /// The pending setup actions
    _setup_actions: SetupAction[];
    /// The plan
    _program_actions: ProgramAction[];
    /// The pending setup actions
    _pending_program_actions: TopologicalSort;

    /// Constructor
    constructor(program: Program, action_graph: proto.action.ActionGraph) {
        this._program = program;

        // Translate the setup actions
        this._setup_actions = [];
        for (let i = 0; i < action_graph.setupActionsLength(); ++i) {
            const _a = action_graph.setupActions(i);
            this._setup_actions.push(new SetupAction());
        }

        // Translate the program actions
        let program_deps: [TopoKey, TopoRank][] = [];
        this._program_actions = [];
        for (let i = 0; i < action_graph.programActionsLength(); ++i) {
            const a = action_graph.programActions(i)!;
            const s = program.getStatement(a.originStatement());
            const p = new ProgramAction(s);
            this._program_actions.push(p);
            program_deps.push([i, a.dependsOnLength()]);
        }

        // Collect dependencies
        this._pending_program_actions = new TopologicalSort(program_deps);
    }
};
