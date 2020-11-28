// Copyright (c) 2020 The DashQL Authors

import { syntax as sx } from '../proto/';
import { NativeStack, NativeBitmap } from '../utils';

const decoder = new TextDecoder();

export class Program {
    /// The text buffer
    _text: Uint8Array;
    /// The program
    _program: sx.Program;

    /// Constructor
    public constructor(text: Uint8Array = new Uint8Array(0), program: sx.Program = new sx.Program()) {
        this._text = text;
        this._program = program || new sx.Program();
    }

    /// Access the text
    public get text() { return this._text; }
    /// Access the buffer
    public get buffer() { return this._program; }

    /// Access the text
    public textAt(_loc: sx.Location): string {
        const view = new Uint8Array(this.text.buffer, _loc.offset(), _loc.length());
        return decoder.decode(view);
    }

    /// Iterate over statements
    public iterateStatements(fn: (idx: number, node: Statement) => void): number {
        const stmt = new Statement(this);
        const count = this.buffer.statementsLength();
        for (let i = 0; i < count; ++i) {
            stmt.statement_id = i;
            stmt.statement = this.buffer.statements(i, stmt.statement)!;
            fn(i, stmt);
        }
        return count;
    };

    /// Iterate over statements
    public iterateDependencies(fn: (idx: number, node: sx.Dependency) => void): number {
        let dep = new sx.Dependency();
        const count = this.buffer.dependenciesLength();
        for (let i = 0; i < count; ++i) {
            dep = this.buffer.dependencies(i, dep)!;
            fn(i, dep);
        }
        return count;
    };
};

export class Node {
    /// The module
    _program: Program;
    /// The node
    _node: sx.Node;

    /// Constructor
    public constructor(program: Program, node: sx.Node = new sx.Node()) {
        this._program = program;
        this._node = node;
    } 
    /// Get the module
    public get program() { return this._program; }
    /// Get the node
    public get node() { return this._node; }
    /// Get the node
    public set node(n: sx.Node) { this._node = n; }
    /// Get the parent
    public get parent() { return this._node.parent(); }
    /// Get the key
    public get key() { return this._node.attributeKey(); }
    /// Get the key
    public get text() { return this._program.text; }
    /// Get the node type
    public get nodeType() { return this._node.nodeType(); }

    /// Assume boolean value
    public assumeBool(): boolean { return this._node.childrenBeginOrValue() != 0; }
    /// Assume number value
    public assumeNumber(): number { return this._node.childrenBeginOrValue(); }
    /// Assume number value
    public assumeString(obj: sx.Location = new sx.Location()): string { return this._program.textAt(this._node.location(obj)!); }

    /// Get as boolean
    public getBool(): boolean | null {
        return (this._node.nodeType() != sx.NodeType.BOOL) ? null : (this._node.childrenBeginOrValue() != 0);
    }
    /// Get as number
    public getNumber(): number | null {
        return (this._node.nodeType() != sx.NodeType.UI32) ? null : this._node.childrenBeginOrValue();
    }
    /// Get a string
    public getString(obj: sx.Location): string | null {
        const loc = this._node.location(obj)!;
        return (this._node.nodeType() != sx.NodeType.STRING_REF) ? null : this._program.textAt(loc);
    }

    /// Find an attribute
    public findAttribute(key: sx.AttributeKey, n: Node | null = null): Node | null {
        let children_begin = this._node.childrenBeginOrValue();
        let children_count = this._node.childrenCount();
        n = n || new Node(this._program);
        let lb = children_begin;
        let c = children_count;
        while (c > 0) {
            const step = Math.floor(c / 2);
            const iter = lb + step;
            n.node = this.program.buffer.nodes(iter, n.node)!;
            if (n.node.attributeKey() < key) {
                lb = iter + 1;
                c -= step + 1;
            } else {
                c = step;
            }
        }
        if (lb >= children_begin + children_count) {
            return null;
        }
        n.node = this.program.buffer.nodes(lb, n.node)!;
        return (n.node.attributeKey() == key) ? n : null;
    }

    /// Iterate over children.
    public iterateChildren(fn: (idx: number, node: Node) => void, n: Node | null = null): number {
        const begin = this._node.childrenBeginOrValue();
        const count = this._node.childrenCount();
        n = n || new Node(this._program);
        for (let i = 0; i < count; ++i) {
            n.node = this.program.buffer.nodes(begin + i, n.node)!;
            fn(i, n);
        }
        return count;
    }
}

/// A single step in a node path
export class NodePathStep {
    /// The node id
    node_id: number;
    /// The attribute key, NONE if array element
    attribute_key: sx.AttributeKey;
    /// The index of the node within the parent
    index_in_parent: number;
    /// The number of visited children
    visited_children: number;

    constructor(node_id: number, attribute_key: sx.AttributeKey, index_in_parent: number) {
        this.node_id = node_id;
        this.attribute_key = attribute_key;
        this.index_in_parent = index_in_parent;
        this.visited_children = 0;
    }
};

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
    visit(node_id: number, node: Node) {
        // Pop from path until we find our parent
        const parent_id = node.parent;
        while (this.steps.length > 0 && this.steps[this.steps.length - 1].node_id != parent_id) {
            this.steps.pop();
        }

        // Determine the index within the parent
        let index_in_parent = 0;
        if (this.steps.length > 0) {
            const parent = this.steps[this.steps.length - 1];
            index_in_parent = parent.visited_children++;
        }

        // Push node
        this.steps.push(new NodePathStep(node_id, node.key, index_in_parent));
    }
}

export class Statement {
    /// The module
    _program: Program;
    /// The statement id
    _statement_id: number;
    /// The statement
    _statement: sx.Statement;

    /// Constructor
    public constructor(module: Program, statement_id: number = -1, statement: sx.Statement = new sx.Statement()) {
        this._program = module;
        this._statement_id = statement_id;
        this._statement = statement;
    }

    /// Access the text
    public get text() { return this._program.text; }
    /// Get the module buffer
    public get program() { return this._program.buffer; }
    /// Get the statement id
    public get statement_id() { return this._statement_id; }
    /// Set the statement id
    public set statement_id(id: number) { this._statement_id = id; }
    /// Get the statement buffer
    public get statement() { return this._statement; }
    /// Set the statement buffer
    public set statement(s: sx.Statement) { this._statement = s; }
    /// Get the short name
    public get target_name_short() { return this._statement.nameShort(); }
    /// Get the qualified name
    public get target_name_qualified() { return this._statement.nameQualified(); }
    /// Get the root
    public get root() { return this._statement.rootNode(); }
    /// Get the root node
    public root_node(obj: Node | null = null) {
        const n = obj || new Node(this._program);
        n.node = this.program.nodes(this._statement.rootNode(), n.node)!;
        return n;
    }

    /// Perform a pre-order DFS traversal
    public traversePreOrder(visit: (node_id: number, node: Node, path: NodePath) => void) {
        // Prepare the DFS
        const path = new NodePath(this._statement_id);
        const pending_cap = this.program.nodesLength() / this.program.statementsLength();
        const pending = new NativeStack(pending_cap);
        pending.push(this._statement.rootNode());

        // We always pass the same objects to the function to spare us all the allocations.
        // The function MUST NOT store the node elsewhere.
        const current = new Node(this._program);

        while (!pending.empty()) {
            const top = pending.pop();
            current.node = this.program.nodes(top, current.node)!;
            const node = current.node;
            const nodeType = current.nodeType;

            // Visit the node pre-order
            path.visit(top, current);
            visit(top, current, path);

            // Discover children
            if (nodeType == sx.NodeType.ARRAY || nodeType > sx.NodeType.OBJECT_MIN) {
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
    public traverse(visit_preorder: (node_id: number, node: Node, path: NodePath) => void, visit_postorder: (node_id: number, node: Node) => void) {
        // Prepare the DFS
        const path = new NodePath(this._statement_id);
        const pending_cap = this.program.nodesLength() / this.program.statementsLength();
        const pending = new NativeStack(pending_cap);
        pending.push(this._statement.rootNode());

        /// Use a compact bitmap to track visited nodes
        const visited = new NativeBitmap(this.program.nodesLength());

        // We always pass the same objects to the function to spare us all the allocations.
        // The function MUST NOT store the node elsewhere.
        const current = new Node(this._program);

        while (!pending.empty()) {
            const top = pending.top();
            current.node = this.program.nodes(top, current.node)!;
            const node = current.node;
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
            if (nodeType == sx.NodeType.ARRAY || nodeType > sx.NodeType.OBJECT_MIN) {
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
