import * as Immutable from 'immutable';
import * as proto from 'tigon-proto';
import * as jspb from 'google-protobuf';

// Filter a statement list
export function filterStatements(
    list: Immutable.List<proto.tql.Statement>,
    t: proto.tql.Statement.StatementCase,
    fn: (i: number, m: jspb.Message) => void,
) {
    let i = 0;
    list.forEach(s => {
        if (s.getStatementCase() !== t) {
            return;
        }
        switch (s.getStatementCase()) {
            case proto.tql.Statement.StatementCase.EXTRACT:
                fn(i++, s.getExtract()!);
                break;
            case proto.tql.Statement.StatementCase.LOAD:
                fn(i++, s.getLoad()!);
                break;
            case proto.tql.Statement.StatementCase.PARAMETER:
                fn(i++, s.getParameter()!);
                break;
            case proto.tql.Statement.StatementCase.QUERY:
                fn(i++, s.getQuery()!);
                break;
            case proto.tql.Statement.StatementCase.VIZ:
                fn(i++, s.getViz()!);
                break;
        }
    });
}

// Map a statement list
export function mapStatements<T extends jspb.Message, V>(
    list: Immutable.List<proto.tql.Statement>,
    t: proto.tql.Statement.StatementCase,
    fn: (i: number, s: T) => V,
): Array<V> {
    let r = new Array<V>();
    filterStatements(list, t, (i: number, m: jspb.Message) => {
        r.push(fn(i, m as T));
    });
    return r;
}
