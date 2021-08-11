import * as arrow from 'apache-arrow';

export type RowProxyCtor = (vector: arrow.StructVector, row: number) => any;
export type AttributeProxy = (vector: arrow.StructVector, row: number) => any;

/// Proxy a single attribute
function proxyAttribute(name: string, type: arrow.Type): AttributeProxy {
    switch (type) {
        case arrow.Type.Date:
        case arrow.Type.DateDay:
        case arrow.Type.DateMillisecond:
            return (vector: arrow.StructVector, row: number) => vector.get(row)!.get(name).toString();
        default:
            return (vector: arrow.StructVector, row: number) => vector.get(row)!.get(name);
    }
}

export function defineRowProxy(schema: arrow.Schema): RowProxyCtor {
    const ctor = function (this: any, vector: arrow.StructVector, row: number) {
        this.__vector__ = vector;
        this.__row__ = row;
    };
    Object.defineProperty(ctor.prototype, '__vector__', {
        enumerable: false,
        writable: true,
    });
    Object.defineProperty(ctor.prototype, '__row__', {
        value: -1,
        enumerable: false,
        writable: true,
    });
    const attributes = schema.fields.map(f => proxyAttribute(f.name, f.typeId));
    ctor.prototype.__attribute__ = function (i: number) {
        return attributes[i](this.__vector__, this.__row__);
    };
    for (let i = 0; i < attributes.length; ++i) {
        const proxy = attributes[i];
        Object.defineProperty(ctor.prototype, schema.fields[i].name, {
            get: function () {
                return proxy(this.__vector__, this.__row__);
            },
            enumerable: true,
        });
    }
    return (vector: arrow.Vector, row: number) => new (ctor as any)(vector, row);
}

export function proxyTable(table: arrow.Table): any[] {
    const chunks = table.chunks;
    const createProxy = defineRowProxy(table.schema);
    const proxies = [];
    for (const chunk of chunks) {
        const batch = chunk as arrow.StructVector;
        for (let i = 0; i < batch.length; ++i) {
            proxies.push(createProxy(batch, i));
        }
    }
    return proxies;
}
