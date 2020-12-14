import * as proto from "@dashql/proto";
import { TopologicalSort, TopoKey, TopoRank } from "./utils";
import { SetupAction, ProgramAction, translateSetupAction, translateProgramAction } from "./actions";
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
            const a = action_graph.setupActions(i)!;
            this._setup_actions.push(translateSetupAction(a));
        }

        // Translate the program actions
        this._program_actions = [];
        for (let i = 0; i < action_graph.programActionsLength(); ++i) {
            const a = action_graph.programActions(i)!;
            this._program_actions.push(translateProgramAction(this._program, a));
        }

        // Build the dependency heap
        let program_deps: [TopoKey, TopoRank][] = [];
        this._program_actions = [];
        for (let i = 0; i < action_graph.programActionsLength(); ++i) {
            const a = action_graph.programActions(i)!;
            program_deps.push([i, a.dependsOnLength()]);

        }
        this._pending_program_actions = new TopologicalSort(program_deps);
    }
};
