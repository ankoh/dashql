import * as platform from '../platform';
import * as model from '../model';
import * as duckdb from '@dashql/duckdb';
import * as proto from '@dashql/proto';

export abstract class VegaLiteEditOperation {
    /// Prepare the completion
    abstract prepare(): void;
    /// Apply the edit operation
    abstract apply(): Promise<void>;
}

function readDomainValues(type: duckdb.SQLType, values: duckdb.Value[], out: model.DomainValues) {
    let cast: (v: duckdb.Value) => model.DomainValue;
    switch (type.typeId) {
        case proto.duckdb.SQLTypeID.BOOLEAN:
        case proto.duckdb.SQLTypeID.TINYINT:
        case proto.duckdb.SQLTypeID.SMALLINT:
        case proto.duckdb.SQLTypeID.INTEGER:
            cast = (v: duckdb.Value) => v.castAsInteger();
            break;

        case proto.duckdb.SQLTypeID.FLOAT:
        case proto.duckdb.SQLTypeID.DECIMAL:
        case proto.duckdb.SQLTypeID.DOUBLE:
            cast = (v: duckdb.Value) => v.castAsFloat();
            break;

        case proto.duckdb.SQLTypeID.CHAR:
        case proto.duckdb.SQLTypeID.VARCHAR:
        case proto.duckdb.SQLTypeID.VARBINARY:
        case proto.duckdb.SQLTypeID.BLOB:
            cast = (v: duckdb.Value) => v.castAsString();
            break;

        case proto.duckdb.SQLTypeID.DATE:
        case proto.duckdb.SQLTypeID.BIGINT:
        case proto.duckdb.SQLTypeID.TIMESTAMP:
        case proto.duckdb.SQLTypeID.INTERVAL:
        case proto.duckdb.SQLTypeID.HUGEINT:
        case proto.duckdb.SQLTypeID.TIME:
            cast = (v: duckdb.Value) => v.castAsString();
            console.warn('shortcut');
            break;

        default:
            cast = (v: duckdb.Value) => null;
            break;
    }
    while (out.length < values.length) out.push(null);
    for (let i = 0; i < values.length; ++i) {
        out[i] = cast(values[i]);
    }
}

export class ResolveMinMaxDomain extends VegaLiteEditOperation {
    /// The statistics queue
    _statistics: platform.TableStatisticsResolver;
    /// The attribute id
    _attribute: number;
    /// The domain object
    _out: model.DomainValues;
    /// The promises
    _promises: Promise<duckdb.Value[]>[];

    constructor(stats: platform.TableStatisticsResolver, attribute: number, out: model.DomainValues) {
        super();
        this._statistics = stats;
        this._out = out;
        this._attribute = attribute;
        this._promises = [];
    }

    /// Prepare the table statitistics
    prepare() {
        const min = this._statistics.request(model.TableStatisticsType.MINIMUM_VALUE, this._attribute);
        const max = this._statistics.request(model.TableStatisticsType.MAXIMUM_VALUE, this._attribute);
        this._promises = [min, max];
        console.assert(this._out.length == 0);
        this._out.push(null);
        this._out.push(null);
    }

    /// Evaluate table statistics and update the domain spec
    async apply(): Promise<void> {
        const results = await Promise.all(this._promises!);
        const flatResults = results.map(r => r[0]);
        const table = this._statistics.resolveTableInfo()!;
        const type = table.columnTypes[this._attribute];
        readDomainValues(type, flatResults, this._out);
    }
}

export class ResolveCategorialDomain extends VegaLiteEditOperation {
    /// The statistics queue
    _statistics: platform.TableStatisticsResolver;
    /// The attribute id
    _attribute: number;
    /// The domain object
    _out: model.DomainValues;
    /// The promise
    _promise: Promise<duckdb.Value[]> | null;

    constructor(stats: platform.TableStatisticsResolver, attribute: number, out: model.DomainValues) {
        super();
        this._statistics = stats;
        this._attribute = attribute;
        this._out = out;
        this._promise = null;
    }

    /// Request
    prepare() {
        this._promise = this._statistics.request(model.TableStatisticsType.DISTINCT_VALUES, this._attribute);
    }

    /// Evaluate table statistics and update the domain spec
    async apply(): Promise<void> {
        const results = await this._promise!;
        const table = this._statistics.resolveTableInfo()!;
        const type = table.columnTypes[this._attribute];
        readDomainValues(type, [results[0]], this._out);
    }
}
