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

    /// Access the text
    public get text() { return this._module.text; }
    /// Get the module
    public get buffer() { return this._module.buffer; }

    /// Find an attribute
    public findAttribute(key: sx.AttributeKey, obj: sx.Node): sx.Node {
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
        return this.buffer.nodes(iter, obj)!;
    }

    /// Get a string
    public getString(obj: sx.Location): string | null {
        return (this._node.nodeType() != sx.NodeType.STRING) ? null : this._module.textAt(obj);
    }
    /// Get as number
    public getNumber(): number | null {
        return (this._node.nodeType() != sx.NodeType.UI32) ? null : this._node.childrenBeginOrValue();
    }
    /// Get as boolean
    public getBool(): boolean | null {
        return (this._node.nodeType() != sx.NodeType.BOOL) ? null : (this._node.childrenBeginOrValue() != 0);
    }
}
