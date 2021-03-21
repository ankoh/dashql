// Copyright (c) 2020 The DashQL Authors

import { ProgramInstance } from './program_instance';
import * as proto from '@dashql/proto';

export class Plan {
    /// The program
    public readonly programInstance: ProgramInstance;
    /// The module
    public readonly buffer: proto.analyzer.Plan;

    /// Constructor
    public constructor(program_instance: ProgramInstance, plan: proto.analyzer.Plan = new proto.analyzer.Plan()) {
        this.programInstance = program_instance;
        this.buffer = plan;
    }

    /// Access the program
    public get program() { return this.programInstance.program; }
    /// Access the parameters
    public get parameters() { return this.programInstance.parameters; }
    /// Access the action graph
    public get action_graph() { return this.buffer.actionGraph(); }

    /// Iterate setup actions
    public iterateSetupActions(fn: (idx: number, node: proto.action.SetupAction) => void) {
        const graph = this.buffer.actionGraph();
        if (!graph) return;
        const count = graph.setupActionsLength();
        const tmp = new proto.action.SetupAction();
        for (let i = 0; i < count; ++i) {
            fn(i, graph.setupActions(i, tmp)!);
        }
    }
    /// Iterate setup actions in reverse order
    public iterateSetupActionsReverse(fn: (idx: number, node: proto.action.SetupAction) => void) {
        const graph = this.buffer.actionGraph();
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
        const graph = this.buffer.actionGraph();
        if (!graph) return;
        const count = graph.programActionsLength();
        const tmp = new proto.action.ProgramAction();
        for (let i = 0; i < count; ++i) {
            fn(i, graph.programActions(i, tmp)!);
        }
    }

    /// Map program actions
    public mapProgramActions<T>(fn: (idx: number, node: proto.action.ProgramAction) => T): T[] {
        const graph = this.buffer.actionGraph();
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
        const graph = this.buffer.actionGraph();
        if (!graph) return [];
        let mapped: T[] = [];
        mapped.length = graph.programActionsLength();
        this.iterateSetupActions((i, n) => {
            mapped[i] = fn(i, n);
        });
        return mapped;
    }
}
