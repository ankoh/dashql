// Copyright (c) 2020 The DashQL Authors

import * as Immutable from 'immutable';
import { Program, Node } from './program';
import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import { PhysicalType } from '@dashql/webdb';
import value from '*.wasm';

export class ProgramInstance {
    /// The program
    _program: Program;
    /// The parameters
    _parameters: Immutable.List<any>;
    /// The instantiated program
    _annotations: proto.analyzer.ProgramAnnotations;
    /// The evaluated nodes
    _evaluatedNodes: Map<number, webdb.Value>;

    /// Constructor
    public constructor(program: Program, params: Immutable.List<any>, annotations: proto.analyzer.ProgramAnnotations) {
        this._program = program;
        this._parameters = params;
        this._annotations = annotations;
        this._evaluatedNodes = new Map();

        for (let i = 0; i < annotations.evaluatedNodesLength(); ++i) {
            const node = annotations.evaluatedNodes(i)!;
            this._evaluatedNodes.set(node.nodeId(), webdb.Value.FromProto(node.value()!));
        }
    }

    /// Get the annotations
    public get annotations() {
        return this._annotations;
    }
    /// Access the program
    public get program() {
        return this._program;
    }
    /// Access the parameters
    public get parameters() {
        return this._parameters;
    }

    /// Read a node as a SQL value
    public readNodeValue(i: number, v: webdb.Value | null = null): webdb.Value {
        if (this._evaluatedNodes.has(i)) {
            return this._evaluatedNodes.get(i)!;
        }
        v = v || new webdb.Value();
        v.resetValue();
        const n = this._program.getNode(i);
        const nt = n.nodeType;
        switch (nt) {
            case proto.syntax.NodeType.BOOL:
            case proto.syntax.NodeType.UI32:
            case proto.syntax.NodeType.UI32_BITMAP:
                v.rawValue = {
                    type: PhysicalType.NUMBER,
                    value: n.assumeNumber(),
                };
                break;
            case proto.syntax.NodeType.STRING_REF:
                v.rawValue = {
                    type: PhysicalType.STRING,
                    value: n.assumeString(),
                };
                break;
                break;
            default:
                if (nt > proto.syntax.NodeType.ENUM_KEYS_ && nt < proto.syntax.NodeType.OBJECT_KEYS_) {
                    v.rawValue = {
                        type: PhysicalType.NUMBER,
                        value: n.assumeNumber(),
                    };
                }
                break;
        }
        return v;
    }
}
