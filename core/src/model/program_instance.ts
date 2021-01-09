// Copyright (c) 2020 The DashQL Authors

import * as Immutable from "immutable";
import { Program } from './program';
import * as proto from '@dashql/proto';

export class ProgramInstance {
    /// The program
    _program: Program;
    /// The parameters
    _parameters: Immutable.List<any>;
    /// The instantiated program
    _annotations: proto.analyzer.ProgramAnnotations;

    /// Constructor
    public constructor(program: Program, params: Immutable.List<any>, annotations: proto.analyzer.ProgramAnnotations) {
        this._program = program;
        this._parameters = params;
        this._annotations = annotations;
    }

    /// Get the annotations
    public get annotations() { return this._annotations; }
    /// Access the program
    public get program() { return this._program; }
    /// Access the parameters
    public get parameters() { return this._parameters; }
}
