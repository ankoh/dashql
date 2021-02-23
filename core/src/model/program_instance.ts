// Copyright (c) 2020 The DashQL Authors

import * as Immutable from "immutable";
import { Program, Node } from './program';
import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';

export class ProgramInstance {
    /// The program
    _program: Program;
    /// The parameters
    _parameters: Immutable.List<any>;
    /// The instantiated program
    _annotations: proto.analyzer.ProgramAnnotations;
    /// The evaluated nodes
    _evaluatedNodes: Map<number, proto.analyzer.NodeValue>;

    /// Constructor
    public constructor(program: Program, params: Immutable.List<any>, annotations: proto.analyzer.ProgramAnnotations) {
        this._program = program;
        this._parameters = params;
        this._annotations = annotations;
        this._evaluatedNodes = new Map();
        for (let i = 0; i < annotations.evaluatedNodesLength(); ++i) {
            const node = annotations.evaluatedNodes(i)!;
            this._evaluatedNodes.set(node.nodeId(), node);
        }
    }

    /// Get the annotations
    public get annotations() { return this._annotations; }
    /// Access the program
    public get program() { return this._program; }
    /// Access the parameters
    public get parameters() { return this._parameters; }

    // /// Read a node as a string
    // public readNodeValue(i: number, n: Node | null = null): webdb.Value {
    //     if (this._evaluatedNodes.has(i)) {
    //         return this._evaluatedNodes.get(i)?.value();
    //     }
    // }
}
