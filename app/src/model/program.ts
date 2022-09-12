// Copyright (c) 2020 The DashQL Authors

import { NativeStack, NativeBitmap, countLines } from '../utils';
import * as proto from '@dashql/dashql-proto';
import * as flatbuffers from 'flatbuffers';
import { TaskStatusCode } from './task_status';

const decoder = new TextDecoder();

export class Program {
    /// The program id
    public readonly programId: number;
    /// The encoded text buffer as utf8
    public readonly textBuffer: Uint8Array;
    /// The decoded text
    public readonly text: string;
    /// The line count
    public readonly textLineCount: number;
    /// The file size
    public readonly textBytes: number;
    /// The program
    public readonly ast: proto.Program;

    /// Constructor
    public constructor(programId: number, text: Uint8Array, program: Uint8Array) {
        this.programId = programId;

        // Read text
        this.textBuffer = text;
        this.text = decoder.decode(text);
        this.textLineCount = countLines(this.text);
        this.textBytes = this.textBuffer.length;

        // Read program
        this.ast = proto.Program.getRootAsProgram(new flatbuffers.ByteBuffer(program));
    }

    /// The line break offsets
    public getLineBreaks(): Float64Array {
        const n = this.ast.lineBreaksLength();
        const breaks = new Float64Array(n);
        const tmpLoc = new proto.Location();
        for (let i = 0; i < n; ++i) {
            breaks[i] = this.ast.lineBreaks(i, tmpLoc)!.offset();
        }
        return breaks;
    }

    /// Access the text
    public textAt(loc: proto.Location): string {
        const view = new Uint8Array(this.textBuffer.buffer, loc.offset(), loc.length());
        return decoder.decode(view);
    }

    /// Get a node
    public getNode(i: number, n: Node | null = null): Node {
        n = n || new Node(this);
        n.buffer = this.ast.nodes(i, n.buffer)!;
        return n;
    }

    /// Get a statement
    public getStatement(i: number): Statement {
        const stmt = new Statement(this);
        stmt.statementId = i;
        stmt.statement = this.ast.statements(i, stmt.statement)!;
        return stmt;
    }

    /// Iterate over statements
    public iterateStatements(fn: (idx: number, node: Statement) => void): number {
        const stmt = new Statement(this);
        const count = this.ast.statementsLength();
        for (let i = 0; i < count; ++i) {
            stmt.statementId = i;
            stmt.statement = this.ast.statements(i, stmt.statement)!;
            fn(i, stmt);
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
    public buffer: proto.Node;

    /// Constructor
    public constructor(program: Program, node: proto.Node = new proto.Node()) {
        this.program = program;
        this.buffer = node;
    }
    /// Get the module
    public get programBuffer(): proto.Program {
        return this.program.ast;
    }
    /// Get the parent
    public get parent(): number {
        return this.buffer.parent();
    }
    /// Get the key
    public get key(): proto.AttributeKey {
        return this.buffer.attributeKey();
    }
    /// Get the node type
    public get nodeType(): proto.NodeType {
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
    public assumeString(obj: proto.Location = new proto.Location()): string {
        return this.program.textAt(this.buffer.location(obj)!);
    }

    /// Is an object?
    public isObject(): boolean {
        return this.buffer.nodeType() >= proto.NodeType.OBJECT_KEYS_;
    }
    /// Get as boolean
    public getBool(): boolean | null {
        return this.buffer.nodeType() != proto.NodeType.BOOL ? null : this.buffer.childrenBeginOrValue() != 0;
    }
    /// Get as number
    public getNumber(): number | null {
        const t = this.buffer.nodeType();
        switch (t) {
            case proto.NodeType.UI32:
            case proto.NodeType.UI32_BITMAP:
                return this.buffer.childrenBeginOrValue();
            default:
                if (t > proto.NodeType.ENUM_KEYS_ && t < proto.NodeType.OBJECT_KEYS_) {
                    return this.buffer.childrenBeginOrValue();
                }
                return null;
        }
    }
    /// Get a string
    public getString(obj: proto.Location = new proto.Location()): string | null {
        const loc = this.buffer.location(obj)!;
        return this.buffer.nodeType() != proto.NodeType.STRING_REF ? null : this.program.textAt(loc);
    }

    /// Find an attribute
    public findAttribute(key: proto.AttributeKey, n: Node | null = null): Node | null {
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
    public readonly attributeKey: proto.AttributeKey;
    /// The index of the node within the parent
    public readonly indexInParent: number;
    /// The number of visited children
    visitedChildren: number;

    constructor(nodeId: number, attributeKey: proto.AttributeKey, indexInParent: number) {
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
    _statement: proto.Statement;

    /// Constructor
    public constructor(module: Program, statementId = -1, statement: proto.Statement = new proto.Statement()) {
        this._program = module;
        this._statementId = statementId;
        this._statement = statement;
    }

    /// Get the module buffer
    public get program(): Program {
        return this._program;
    }
    /// Get the module buffer
    public get programBuffer(): proto.Program {
        return this._program.ast;
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
    public get statement(): proto.Statement {
        return this._statement;
    }
    /// Set the statement buffer
    public set statement(s: proto.Statement) {
        this._statement = s;
    }
    /// Get the statement type
    public get statement_type(): proto.StatementType {
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
            if (nodeType == proto.NodeType.ARRAY || nodeType > proto.NodeType.OBJECT_KEYS_) {
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
            if (nodeType == proto.NodeType.ARRAY || nodeType > proto.NodeType.OBJECT_KEYS_) {
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
    status: TaskStatusCode;
    totalTasks: number;
    totalPerStatus: number[];
}

/// Derive a statement status
export function deriveStatementStatusCode(s: StatementStatus): TaskStatusCode {
    if (s.totalTasks == 0) {
        return TaskStatusCode.Skipped;
    }
    let best = TaskStatusCode.Pending;
    if (s.totalTasks == s.totalPerStatus[TaskStatusCode.Completed]) {
        best = TaskStatusCode.Completed;
    } else {
        for (const code of [
            TaskStatusCode.Pending,
            TaskStatusCode.Skipped,
            TaskStatusCode.Preparing,
            TaskStatusCode.Prepared,
            TaskStatusCode.Executing,
            TaskStatusCode.Blocked,
            TaskStatusCode.Failed,
        ]) {
            if (s.totalPerStatus[code] > 0) {
                best = code;
            }
        }
    }
    return best;
}
