// Copyright (c) 2020 The DashQL Authors

import { FlatBuffer } from './buffer';
import { Program } from './program';
import * as proto from '@dashql/proto';

export class PlanBuffer extends FlatBuffer<proto.session.Plan> {
    public getRoot(buffer: flatbuffers.ByteBuffer) {
        return proto.session.Plan.getRoot(buffer);
    }
}

export class Plan {
    /// The program
    _program: Program;
    /// The module
    _plan: FlatBuffer<proto.session.Plan>;

    /// Constructor
    public constructor(program: Program, plan: FlatBuffer<proto.session.Plan> = new PlanBuffer()) {
        this._program = program;
        this._plan = plan;
    }

    /// Get the buffer
    public get buffer() { return this._plan; }
    /// Access the program
    public get program() { return this._program; }
    /// Access the action graph
    public get action_graph() { return this._plan.root.actionGraph(); }

    /// Iterate setup actions
    public iterateSetupActions(fn: (idx: number, node: proto.action.SetupAction) => void) {
        const graph = this._plan.root.actionGraph();
        if (!graph) return;
        const count = graph.setupActionsLength();
        const tmp = new proto.action.SetupAction();
        for (let i = 0; i < count; ++i) {
            fn(i, graph.setupActions(i, tmp)!);
        }
    }
    /// Iterate program actions
    public iterateProgramActions(fn: (idx: number, node: proto.action.ProgramAction) => void) {
        const graph = this._plan.root.actionGraph();
        if (!graph) return;
        const count = graph.programActionsLength();
        const tmp = new proto.action.ProgramAction();
        for (let i = 0; i < count; ++i) {
            fn(i, graph.programActions(i, tmp)!);
        }
    }
}
