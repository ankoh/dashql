import { GetVisitor } from 'apache-arrow/visitor/get';
import { Table } from 'apache-arrow/table';
import { Type } from 'apache-arrow/enum';

export function tableToJSON(table: Table): any[] {
    const out = [];
    for (let row = 0; row < table.numRows; ++row) {
        out.push({});
    }
    const vectors = [];
    const visitors = [];
    const visitorFactory = new GetVisitor();
    for (let cid = 0; cid < table.numCols; ++cid) {
        const field = table.schema.fields[cid];
        const vec = table.getChildAt(cid)!;
        vectors.push(vec);
        const inner = visitorFactory.getVisitFn(vec);
        let visit = inner;
        switch (field.typeId) {
            case Type.Date:
            case Type.DateDay:
            case Type.DateMillisecond:
                visit = (batch, local) => inner(batch, local)?.getTime();
                break;
            default:
                break;
        }
        visitors.push(visit);
    }
    let global = 0;
    for (let bid = 0; bid < vectors[0].data.length; ++bid) {
        let batchSize = 0;
        for (let cid = 0; cid < table.numCols; ++cid) {
            let writer = global;
            const batch = vectors[cid].data[bid];
            const visit = visitors[cid];
            const field = table.schema.fields[cid];
            for (let local = 0; local < batchSize; ++local) {
                out[writer][field.name] = visit(batch, local);
                writer += 1;
            }
            batchSize = batch.length;
        }
        global += batchSize;
    }
    return out;
}
