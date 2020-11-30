// Copyright (c) 2020 The DashQL Authors

import { FlatBuffer, PlanBuffer } from './bindings';
import { Program } from './parser/';
import { session } from './proto/';

export class Plan {
    /// The program
    _program: Program;
    /// The module
    _plan: FlatBuffer<session.Plan>;

    /// Constructor
    public constructor(program: Program, plan: FlatBuffer<session.Plan> = new PlanBuffer()) {
        this._program = program;
        this._plan = plan;
    }

    /// Access the program
    public get program() { return this._program; }
    /// Access the action graph
    public get action_graph() { return this._plan.root.actionGraph(); }
}
