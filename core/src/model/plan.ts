// Copyright (c) 2020 The DashQL Authors

import * as Immutable from "immutable";
import { Program } from './program';
import * as proto from '@dashql/proto';

export class Plan {
    /// The program
    _program: Program;
    /// The program
    _parameters: Immutable.List<any>;
    /// The module
    _plan: proto.analyzer.Plan;

    /// Constructor
    public constructor(program: Program, params: Immutable.List<any>, plan: proto.analyzer.Plan = new proto.analyzer.Plan()) {
        this._program = program;
        this._parameters = params;
        this._plan = plan;
    }

    /// Get the buffer
    public get buffer() { return this._plan; }
    /// Access the program
    public get program() { return this._program; }
    /// Access the parameters
    public get parameters() { return this._parameters; }
    /// Access the action graph
    public get action_graph() { return this._plan.actionGraph(); }

    /// Iterate setup actions
    public iterateSetupActions(fn: (idx: number, node: proto.action.SetupAction) => void) {
        const graph = this._plan.actionGraph();
        if (!graph) return;
        const count = graph.setupActionsLength();
        const tmp = new proto.action.SetupAction();
        for (let i = 0; i < count; ++i) {
            fn(i, graph.setupActions(i, tmp)!);
        }
    }
    /// Iterate setup actions in reverse order
    public iterateSetupActionsReverse(fn: (idx: number, node: proto.action.SetupAction) => void) {
        const graph = this._plan.actionGraph();
        if (!graph) return;
        const count = graph.setupActionsLength();
        const tmp = new proto.action.SetupAction();
        for (let i = 0; i < count; ++i) {
            const ri = count - i - 1;
            fn(ri, graph.setupActions(ri, tmp)!);
        }
    }
    /// Iterate program actions
    public iterateProgramActions(fn: (idx: number, node: proto.action.ProgramAction) => void) {
        const graph = this._plan.actionGraph();
        if (!graph) return;
        const count = graph.programActionsLength();
        const tmp = new proto.action.ProgramAction();
        for (let i = 0; i < count; ++i) {
            fn(i, graph.programActions(i, tmp)!);
        }
    }

    /// Map program actions
    public mapProgramActions<T>(fn: (idx: number, node: proto.action.ProgramAction) => T): T[] {
        const graph = this._plan.actionGraph();
        if (!graph) return [];
        let mapped: T[] = [];
        mapped.length = graph.programActionsLength();
        this.iterateProgramActions((i, n) => {
            mapped[i] = fn(i, n);
        });
        return mapped;
    }

    /// Map setup actions
    public mapSetupActions<T>(fn: (idx: number, node: proto.action.SetupAction) => T): T[] {
        const graph = this._plan.actionGraph();
        if (!graph) return [];
        let mapped: T[] = [];
        mapped.length = graph.programActionsLength();
        this.iterateSetupActions((i, n) => {
            mapped[i] = fn(i, n);
        });
        return mapped;
    }
}
