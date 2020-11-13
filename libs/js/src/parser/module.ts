import { FlatBuffer } from './bindings';
import { syntax as sx } from '../proto/';

export class Module {
    /// The text buffer
    _text: Uint8Array;
    /// The module
    _buffer: FlatBuffer<sx.Module>;

    /// Constructor
    public constructor(text: Uint8Array, module: FlatBuffer<sx.Module>) {
        this._text = text;
        this._buffer = module;
    }

    /// Access the text
    public get text() { return this._text; }
    /// Access the module
    public get buffer() { return this._buffer.root; }

    /// Access the text
    public textAt(_loc: sx.Location): string {
        return "?";
    }
};

export class Node {
    /// The module
    _module: Module;
    /// The node
    _node: sx.Node;

    /// Constructor
    public constructor(module: Module, node: sx.Node) {
        this._module = module;
        this._node = node;
    }

    /// Get the module
    public get module() { return this._module; }
    /// Get the text
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

    /// Iterate over an array (if the node is an array)
    public iterateArray(obj: sx.Node, fn: (idx: number, node: sx.Node) => void): number {
        if (this._node.nodeType() != sx.NodeType.ARRAY) {
            return 0;
        }
        const begin = this._node.childrenBeginOrValue();
        const count = this._node.childrenCount();
        for (let i = 0; i < count; ++i) {
            const node = this.buffer.nodes(begin + i, obj)!;
            fn(i, node);
        }
        return count;
    }
}

export class Statement {
    /// The module
    _module: Module;
    /// The statement
    _statement: sx.Statement;

    /// Constructor
    public constructor(module: Module, statement: sx.Statement) {
        this._module = module;
        this._statement = statement;
    }

    /// Access the text
    public get text() { return this._module.text; }
    /// Get the module
    public get buffer() { return this._module.buffer; }

    /// Traverse the module
    public traverse(_fn: (node: Node) => void) {
    }
}
