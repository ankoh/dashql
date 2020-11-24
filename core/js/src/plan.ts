// Copyright (c) 2020 The DashQL Authors

import { FlatBuffer, PlanBuffer } from './bindings';
import { Program } from './parser/';
import { syntax as sx, session } from './proto/';

export class Plan {
    /// The text buffer
    _text: Uint8Array;
    /// The module
    _plan: FlatBuffer<session.Plan>;
    /// The program
    _program: Program;

    /// Constructor
    public constructor(text: Uint8Array = new Uint8Array(0), plan: FlatBuffer<session.Plan> = new PlanBuffer()) {
        this._text = text;
        this._plan = plan;
        this._program = new Program(text, plan.root.program()!);
    }

    /// Access the text
    public get text() { return this._text; }
    /// Access the buffer
    public get buffer() { return this._plan.root; }
    /// Access the program
    public get program() { return this._program; }
}
