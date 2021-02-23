// Copyright (c) 2020 The DashQL Authors

import * as Immutable from 'immutable';
import { Program, Node } from './program';
import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import { PhysicalType } from '@dashql/webdb';
import value from '*.wasm';

export class ProgramInstance {
    /// The program
    public readonly program: Program;
    /// The parameters
    public readonly parameters: Immutable.List<any>;
    /// The instantiated program
    public readonly annotations: proto.analyzer.ProgramAnnotations;
    /// The evaluated nodes
    public readonly evaluatedNodes: Map<number, webdb.Value>;
    /// The viz specs
    public readonly vizSpecs: Map<number, proto.viz.VizSpec>;

    /// Constructor
    public constructor(program: Program, params: Immutable.List<any>, annotations: proto.analyzer.ProgramAnnotations) {
        this.program = program;
        this.parameters = params;
        this.annotations = annotations;
        this.evaluatedNodes = new Map();
        this.vizSpecs = new Map();

        for (let i = 0; i < annotations.evaluatedNodesLength(); ++i) {
            const node = annotations.evaluatedNodes(i)!;
            this.evaluatedNodes.set(node.nodeId(), webdb.Value.FromProto(node.value()!));
        }
        for (let i = 0; i < annotations.vizSpecsLength(); ++i) {
            const spec = annotations.vizSpecs(i)!;
            this.vizSpecs.set(spec.statementId(), spec);
        }
    }

    /// Read a node as a SQL value
    public readNodeValue(i: number, v: webdb.Value | null = null): webdb.Value {
        if (this.evaluatedNodes.has(i)) {
            return this.evaluatedNodes.get(i)!;
        }
        v = v || new webdb.Value();
        v.setNull();
        const n = this.program.getNode(i);
        const nt = n.nodeType;
        switch (nt) {
            case proto.syntax.NodeType.BOOL:
            case proto.syntax.NodeType.UI32:
            case proto.syntax.NodeType.UI32_BITMAP:
                v.setNumber(n.assumeNumber());
                break;
            case proto.syntax.NodeType.STRING_REF:
                v.setString(n.assumeString());
                break;
            default:
                if (nt > proto.syntax.NodeType.ENUM_KEYS_ && nt < proto.syntax.NodeType.OBJECT_KEYS_) {
                    v.setNumber(n.assumeNumber());
                }
                break;
        }
        return v;
    }
}
