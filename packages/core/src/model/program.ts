// Copyright (c) 2020 The DashQL Authors

import { NativeStack, NativeBitmap } from '../utils';
import { syntax as sx } from '@dashql/proto';
import * as proto from '@dashql/proto';

const decoder = new TextDecoder();

export class Program {
    /// The program text
    public readonly text: string;
    /// The encoded text buffer based to the core
    public readonly textBuffer: Uint8Array;
    /// The program
    public readonly buffer: sx.Program;
    /// The statement dependencies
    public readonly statementDependencies: Map<number, number[]>;

    /// Constructor
    public constructor(text = '', textBuffer: Uint8Array = new Uint8Array(0), program: sx.Program = new sx.Program()) {
        this.text = text;
        this.textBuffer = textBuffer;
        this.buffer = program;

        /// Build statement dependencies
        this.statementDependencies = new Map<number, number[]>();
        this.iterateDependencies((_: number, dep: sx.Dependency) => {
            const deps = this.statementDependencies.get(dep.targetStatement()) || [];
            deps.push(dep.sourceStatement());
            this.statementDependencies.set(dep.targetStatement(), deps);
        });
    }

    /// The line break offsets
    public getLineBreaks(): Float64Array {
        const n = this.buffer.lineBreaksLength();
        const breaks = new Float64Array(n);
        const tmpLoc = new sx.Location();
        for (let i = 0; i < n; ++i) {
            breaks[i] = this.buffer.lineBreaks(i, tmpLoc)!.offset();
        }
        return breaks;
    }

    /// Access the text
    public textAt(_loc: sx.Location): string {
        const view = new Uint8Array(this.textBuffer.buffer, _loc.offset(), _loc.length());
        return decoder.decode(view);
    }

    /// Get a node
    public getNode(i: number, n: Node | null = null): Node {
        n = n || new Node(this);
        n.buffer = this.buffer.nodes(i, n.buffer)!;
        return n;
    }

    /// Get a statement
    public getStatement(i: number): Statement {
        const stmt = new Statement(this);
        stmt.statementId = i;
        stmt.statement = this.buffer.statements(i, stmt.statement)!;
        return stmt;
    }

    /// Iterate over statements
    public iterateStatements(fn: (idx: number, node: Statement) => void): number {
        const stmt = new Statement(this);
        const count = this.buffer.statementsLength();
        for (let i = 0; i < count; ++i) {
            stmt.statementId = i;
            stmt.statement = this.buffer.statements(i, stmt.statement)!;
            fn(i, stmt);
        }
        return count;
    }

    /// Iterate over dependencies
    public iterateDependencies(fn: (idx: number, node: sx.Dependency) => void): number {
        let dep = new sx.Dependency();
        const count = this.buffer.dependenciesLength();
        for (let i = 0; i < count; ++i) {
            dep = this.buffer.dependencies(i, dep)!;
            fn(i, dep);
        }
        return count;
    }
}

export interface InputValue {
    statement: number;
}

export class Node {
    /// The module
    public readonly program: Program;
    /// The node
    public buffer: sx.Node;

    /// Constructor
    public constructor(program: Program, node: sx.Node = new sx.Node()) {
        this.program = program;
        this.buffer = node;
    }
    /// Get the module
    public get programBuffer(): sx.Program {
        return this.program.buffer;
    }
    /// Get the parent
    public get parent(): number {
        return this.buffer.parent();
    }
    /// Get the key
    public get key(): sx.AttributeKey {
        return this.buffer.attributeKey();
    }
    /// Get the node type
    public get nodeType(): sx.NodeType {
        return this.buffer.nodeType();
    }

    /// Assume boolean value
    public assumeBool(): boolean {
        return this.buffer.childrenBeginOrValue() != 0;
    }
    /// Assume number value
    public assumeNumber(): number {
        return this.buffer.childrenBeginOrValue();
    }
    /// Assume number value
    public assumeString(obj: sx.Location = new sx.Location()): string {
        return this.program.textAt(this.buffer.location(obj)!);
    }

    /// Is an object?
    public isObject(): boolean {
        return this.buffer.nodeType() >= sx.NodeType.OBJECT_KEYS_;
    }
    /// Get as boolean
    public getBool(): boolean | null {
        return this.buffer.nodeType() != sx.NodeType.BOOL ? null : this.buffer.childrenBeginOrValue() != 0;
    }
    /// Get as number
    public getNumber(): number | null {
        const t = this.buffer.nodeType();
        switch (t) {
            case sx.NodeType.UI32:
            case sx.NodeType.UI32_BITMAP:
                return this.buffer.childrenBeginOrValue();
            default:
                if (t > proto.syntax.NodeType.ENUM_KEYS_ && t < proto.syntax.NodeType.OBJECT_KEYS_) {
                    return this.buffer.childrenBeginOrValue();
                }
                return null;
        }
    }
    /// Get a string
    public getString(obj: sx.Location = new sx.Location()): string | null {
        const loc = this.buffer.location(obj)!;
        return this.buffer.nodeType() != sx.NodeType.STRING_REF ? null : this.program.textAt(loc);
    }

    /// Find an attribute
    public findAttribute(key: sx.AttributeKey, n: Node | null = null): Node | null {
        const children_begin = this.buffer.childrenBeginOrValue();
        const children_count = this.buffer.childrenCount();
        n = n || new Node(this.program);
        let lb = children_begin;
        let c = children_count;
        while (c > 0) {
            const step = Math.floor(c / 2);
            const iter = lb + step;
            n = this.program.getNode(iter, n)!;
            if (n.buffer.attributeKey() < key) {
                lb = iter + 1;
                c -= step + 1;
            } else {
                c = step;
            }
        }
        if (lb >= children_begin + children_count) {
            return null;
        }
        n = this.program.getNode(lb, n)!;
        return n.buffer.attributeKey() == key ? n : null;
    }

    /// Iterate over children.
    public iterateChildren(fn: (idx: number, node: Node) => void, n: Node | null = null): number {
        const begin = this.buffer.childrenBeginOrValue();
        const count = this.buffer.childrenCount();
        n = n || new Node(this.program);
        for (let i = 0; i < count; ++i) {
            n = this.program.getNode(begin + i, n)!;
            fn(i, n);
        }
        return count;
    }
}

/// A single step in a node path
export class NodePathStep {
    /// The node id
    public readonly nodeId: number;
    /// The attribute key, NONE if array element
    public readonly attributeKey: sx.AttributeKey;
    /// The index of the node within the parent
    public readonly indexInParent: number;
    /// The number of visited children
    visitedChildren: number;

    constructor(nodeId: number, attributeKey: sx.AttributeKey, indexInParent: number) {
        this.nodeId = nodeId;
        this.attributeKey = attributeKey;
        this.indexInParent = indexInParent;
        this.visitedChildren = 0;
    }
}

/// A node stack to maintain the path during a pre-order DFS traversal
export class NodePath {
    /// The statement
    statement: number;
    /// The DFS steps starting from the root
    steps: NodePathStep[];

    constructor(statement: number) {
        this.statement = statement;
        this.steps = [];
    }

    /// Visit a new node
    visit(nodeId: number, node: Node): void {
        // Pop from path until we find our parent
        const parent_id = node.parent;
        while (this.steps.length > 0 && this.steps[this.steps.length - 1].nodeId != parent_id) {
            this.steps.pop();
        }

        // Determine the index within the parent
        let indexInParent = 0;
        if (this.steps.length > 0) {
            const parent = this.steps[this.steps.length - 1];
            indexInParent = parent.visitedChildren++;
        }

        // Push node
        this.steps.push(new NodePathStep(nodeId, node.key, indexInParent));
    }
}

export class Statement {
    /// The module
    _program: Program;
    /// The statement id
    _statementId: number;
    /// The statement
    _statement: sx.Statement;

    /// Constructor
    public constructor(module: Program, statementId = -1, statement: sx.Statement = new sx.Statement()) {
        this._program = module;
        this._statementId = statementId;
        this._statement = statement;
    }

    /// Get the module buffer
    public get program(): Program {
        return this._program;
    }
    /// Get the module buffer
    public get programBuffer(): sx.Program {
        return this._program.buffer;
    }
    /// Get the statement id
    public get statementId(): number {
        return this._statementId;
    }
    /// Set the statement id
    public set statementId(id: number) {
        this._statementId = id;
    }
    /// Get the statement buffer
    public get statement(): sx.Statement {
        return this._statement;
    }
    /// Set the statement buffer
    public set statement(s: sx.Statement) {
        this._statement = s;
    }
    /// Get the statement type
    public get statement_type(): sx.StatementType {
        return this._statement.statementType();
    }
    /// Get the pretty name
    public get namePretty(): string | null {
        return this._statement.namePretty();
    }
    /// Get the qualified name
    public get nameQualified(): string | null {
        return this._statement.nameQualified();
    }
    /// Get the root
    public get root(): number {
        return this._statement.rootNode();
    }
    /// Get the root node
    public root_node(n: Node | null = null): Node {
        return this.program.getNode(this._statement.rootNode(), n)!;
    }

    /// Perform a pre-order DFS traversal
    public traversePreOrder(visit: (nodeId: number, node: Node, path: NodePath) => void): void {
        // Prepare the DFS
        const path = new NodePath(this._statementId);
        const pending_cap = this.programBuffer.nodesLength() / this.programBuffer.statementsLength();
        const pending = new NativeStack(pending_cap);
        pending.push(this._statement.rootNode());

        // We always pass the same objects to the function to spare us all the allocations.
        // The function MUST NOT store the node elsewhere.
        let current = new Node(this._program);

        while (!pending.empty()) {
            const top = pending.pop();
            current = this.program.getNode(top, current)!;
            const node = current.buffer;
            const nodeType = current.nodeType;

            // Visit the node pre-order
            path.visit(top, current);
            visit(top, current, path);

            // Discover children
            if (nodeType == sx.NodeType.ARRAY || nodeType > sx.NodeType.OBJECT_KEYS_) {
                const begin = node.childrenBeginOrValue();
                const count = node.childrenCount();
                const end = begin + count;
                for (let i = 0; i < count; ++i) {
                    pending.push(end - i - 1);
                }
            }
        }
    }

    /// Perform a DFS traversal with preorder and postorder hooks
    public traverse(
        visit_preorder: (nodeId: number, node: Node, path: NodePath) => void,
        visit_postorder: (nodeId: number, node: Node) => void,
    ): void {
        // Prepare the DFS
        const path = new NodePath(this._statementId);
        const pending_cap = this.programBuffer.nodesLength() / this.programBuffer.statementsLength();
        const pending = new NativeStack(pending_cap);
        pending.push(this._statement.rootNode());

        /// Use a compact bitmap to track visited nodes
        const visited = new NativeBitmap(this.programBuffer.nodesLength());

        // We always pass the same objects to the function to spare us all the allocations.
        // The function MUST NOT store the node elsewhere.
        let current = new Node(this._program);

        while (!pending.empty()) {
            const top = pending.top();
            current = this.program.getNode(top, current)!;
            const node = current.buffer;
            const nodeType = current.nodeType;

            // Visit post-order
            if (visited.isSet(top)) {
                visit_postorder(top, current);
                pending.pop();
                continue;
            }

            // Visit the node pre-order
            path.visit(top, current);
            visit_preorder(top, current, path);
            visited.set(top);

            // Discover children
            if (nodeType == sx.NodeType.ARRAY || nodeType > sx.NodeType.OBJECT_KEYS_) {
                const begin = node.childrenBeginOrValue();
                const count = node.childrenCount();
                const end = begin + count;
                for (let i = 0; i < count; ++i) {
                    pending.push(end - i - 1);
                }
            }
        }
    }
}

/// A statement status
export interface StatementStatus {
    status: proto.task.TaskStatusCode;
    totalTasks: number;
    totalPerStatus: number[];
}

/// Derive a statement status
export function deriveStatementStatusCode(status: StatementStatus): proto.task.TaskStatusCode {
    if (status.totalTasks == 0) {
        return proto.task.TaskStatusCode.SKIPPED;
    }
    if (status.totalPerStatus[proto.task.TaskStatusCode.COMPLETED as number] == status.totalTasks) {
        return proto.task.TaskStatusCode.COMPLETED;
    }
    for (const s of [
        proto.task.TaskStatusCode.FAILED,
        proto.task.TaskStatusCode.BLOCKED,
        proto.task.TaskStatusCode.SKIPPED,
        proto.task.TaskStatusCode.RUNNING,
    ]) {
        if (status.totalPerStatus[s as number] > 0) {
            return s;
        }
    }
    return proto.task.TaskStatusCode.PENDING;
}
