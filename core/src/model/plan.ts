// Copyright (c) 2020 The DashQL Authors

import { ProgramInstance } from './program_instance';
import * as proto from '@dashql/proto';

export class Plan {
    /// The program
    _programInstance: ProgramInstance;
    /// The module
    _plan: proto.analyzer.Plan;

    /// Constructor
    public constructor(program_instance: ProgramInstance, plan: proto.analyzer.Plan = new proto.analyzer.Plan()) {
        this._programInstance = program_instance;
        this._plan = plan;
    }

    /// Get the buffer
    public get buffer() { return this._plan; }
    /// Access the program instance
    public get programInstance() { return this._programInstance; }
    /// Access the program
    public get program() { return this._programInstance.program; }
    /// Access the parameters
    public get parameters() { return this._programInstance.parameters; }
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
