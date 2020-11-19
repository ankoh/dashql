// Copyright (c) 2020 The DashQL Authors

import { FlatBuffer, ModuleBuffer } from '../bindings';
import { syntax as sx } from '../proto/';
import { NativeStack, NativeBitmap } from '../utils';

const decoder = new TextDecoder();

export class Module {
    /// The text buffer
    _text: Uint8Array;
    /// The module
    _buffer: FlatBuffer<sx.Module>;

    /// Constructor
    public constructor(text: Uint8Array = new Uint8Array(0), module: FlatBuffer<sx.Module> = new ModuleBuffer()) {
        this._text = text;
        this._buffer = module;
    }

    /// Access the text
    public get text() { return this._text; }
    /// Access the module
    public get buffer() { return this._buffer.root; }

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
            stmt.statement_buffer = this.buffer.statements(i, stmt.statement_buffer)!;
            fn(i, stmt);
        }
        return count;
    };
};

export class Node {
    /// The module
    _module: Module;
    /// The node
    _node: sx.Node;

    /// Constructor
    public constructor(module: Module, node: sx.Node = new sx.Node()) {
        this._module = module;
        this._node = node;
    } 
    /// Get the module
    public get module() { return this._module; }
    /// Get the node
    public get node() { return this._node; }
    /// Get the node
    public set node(n: sx.Node) { this._node = n; }
    /// Get the parent
    public get parent() { return this._node.parent(); }
    /// Get the key
    public get key() { return this._node.attributeKey(); }
    /// Get the key
    public get text() { return this._module.text; }
    /// Get the module
    public get buffer() { return this._module.buffer; }
    /// Get the node type
    public get nodeType() { return this._node.nodeType(); }

    /// Assume boolean value
    public assumeBool(): boolean { return this._node.childrenBeginOrValue() != 0; }
    /// Assume number value
    public assumeNumber(): number { return this._node.childrenBeginOrValue(); }
    /// Assume number value
    public assumeString(obj: sx.Location): string { return this._module.textAt(this._node.location(obj)!); }

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
        return (this._node.nodeType() != sx.NodeType.STRING) ? null : this._module.textAt(loc);
    }

    /// Find an attribute
    public findAttribute(key: sx.AttributeKey, obj: sx.Node): sx.Node | null {
        const begin = this._node.childrenBeginOrValue();
        let count = this._node.childrenCount();
        let iter = begin;
        while (count > 0) {
            const step = count / 2;
            const node = this.buffer.nodes(iter + step, obj)!;
            if (node.attributeKey() < key) {
                iter += step + 1;
                count -= step + 1;
            } else {
                count = step;
            }
        }
        const node = this.buffer.nodes(iter, obj)!;
        return (node.attributeKey() == key) ? node : null;
    }

    /// Iterate over children.
    public iterateChildren(obj: sx.Node, fn: (idx: number, node: sx.Node) => void): number {
        const begin = this._node.childrenBeginOrValue();
        const count = this._node.childrenCount();
        for (let i = 0; i < count; ++i) {
            const node = this.buffer.nodes(begin + i, obj)!;
            fn(i, node);
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
    /// The DFS steps starting from the root
    steps: NodePathStep[];

    constructor() {
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
    _module: Module;
    /// The statement
    _statement: sx.Statement;

    /// Constructor
    public constructor(module: Module, statement: sx.Statement = new sx.Statement()) {
        this._module = module;
        this._statement = statement;
    }

    /// Access the text
    public get text() { return this._module.text; }
    /// Get the module buffer
    public get module_buffer() { return this._module.buffer; }
    /// Get the statement buffer
    public get statement_buffer() { return this._statement; }
    /// Set the statement buffer
    public set statement_buffer(s: sx.Statement) { this._statement = s; }
    /// Get the root
    public get root() { return this._statement.root(); }

    /// Perform a pre-order DFS traversal
    public traversePreOrder(visit: (node_id: number, node: Node, path: NodePath) => void) {
        // Prepare the DFS
        const path = new NodePath();
        const pending_cap = this.module_buffer.nodesLength() / this.module_buffer.statementsLength();
        const pending = new NativeStack(pending_cap);
        pending.push(this._statement.root());

        // We always pass the same objects to the function to spare us all the allocations.
        // The function MUST NOT store the node elsewhere.
        const current = new Node(this._module);

        while (!pending.empty()) {
            const top = pending.pop();
            current.node = this.module_buffer.nodes(top, current.node)!;
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
        const path = new NodePath();
        const pending_cap = this.module_buffer.nodesLength() / this.module_buffer.statementsLength();
        const pending = new NativeStack(pending_cap);
        pending.push(this._statement.root());

        /// Use a compact bitmap to track visited nodes
        const visited = new NativeBitmap(this.module_buffer.nodesLength());

        // We always pass the same objects to the function to spare us all the allocations.
        // The function MUST NOT store the node elsewhere.
        const current = new Node(this._module);

        while (!pending.empty()) {
            const top = pending.top();
            current.node = this.module_buffer.nodes(top, current.node)!;
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
