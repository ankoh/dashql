import * as platform from '../platform';
import * as model from '../model';
import * as v from 'vega';
import * as vl from 'vega-lite';
import * as utils from '../utils';
import * as webdb from '@dashql/webdb';
import * as proto from '@dashql/proto';
import { DateTime } from 'vega-lite/src/datetime';

export abstract class VegaLiteEditOperation {
    /// Prepare the completion
    abstract prepare(): void;
    /// Apply the edit operation
    abstract apply(): Promise<void>;
}

function readDomainValues(type: webdb.SQLType, values: webdb.Value[], out: model.DomainValues) {
    let cast: (v: webdb.Value) => model.DomainValue;
    switch (type.typeId) {
        case proto.webdb.SQLTypeID.BOOLEAN:
        case proto.webdb.SQLTypeID.TINYINT:
        case proto.webdb.SQLTypeID.SMALLINT:
        case proto.webdb.SQLTypeID.INTEGER:
            cast = (v: webdb.Value) => v.castAsInteger();
            break;

        case proto.webdb.SQLTypeID.FLOAT:
        case proto.webdb.SQLTypeID.DECIMAL:
        case proto.webdb.SQLTypeID.DOUBLE:
            cast = (v: webdb.Value) => v.castAsFloat();
            break;

        case proto.webdb.SQLTypeID.CHAR:
        case proto.webdb.SQLTypeID.VARCHAR:
        case proto.webdb.SQLTypeID.VARBINARY:
        case proto.webdb.SQLTypeID.BLOB:
            cast = (v: webdb.Value) => v.castAsString();
            break;

        case proto.webdb.SQLTypeID.DATE:
        case proto.webdb.SQLTypeID.BIGINT:
        case proto.webdb.SQLTypeID.TIMESTAMP:
        case proto.webdb.SQLTypeID.INTERVAL:
        case proto.webdb.SQLTypeID.HUGEINT:
        case proto.webdb.SQLTypeID.TIME:
            cast = (v: webdb.Value) => v.castAsString();
            console.warn('shortcut');
            break;

        case proto.webdb.SQLTypeID.ANY:
        case proto.webdb.SQLTypeID.UNKNOWN:
        case proto.webdb.SQLTypeID.SQLNULL:
        case proto.webdb.SQLTypeID.INVALID:
        case proto.webdb.SQLTypeID.POINTER:
        case proto.webdb.SQLTypeID.HASH:
        case proto.webdb.SQLTypeID.STRUCT:
        case proto.webdb.SQLTypeID.LIST:
            cast = (v: webdb.Value) => null;
            console.error('invalid attribute type');
            break;
    }
    while (out.length < values.length) out.push(null);
    for (let i = 0; i < values.length; ++i) {
        out[i] = cast(values[i]);
    }
}

export class ResolveMinMaxDomain extends VegaLiteEditOperation {
    /// The statistics queue
    _statistics: platform.TableStatistics;
    /// The attribute id
    _attribute: number;
    /// The domain object
    _out: model.DomainValues;
    /// The promises
    _promises: Promise<webdb.Value[]>[];

    constructor(stats: platform.TableStatistics, attribute: number, out: model.DomainValues) {
        super();
        this._statistics = stats;
        this._out = out;
        this._attribute = attribute;
        this._promises = [];
    }

    /// Prepare the table statitistics
    prepare() {
        const min = this._statistics.request(
            model.TableStatisticsType.MINIMUM_VALUE,
            this._attribute,
        );
        const max = this._statistics.request(
            model.TableStatisticsType.MAXIMUM_VALUE,
            this._attribute,
        );
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
    _statistics: platform.TableStatistics;
    /// The attribute id
    _attribute: number;
    /// The domain object
    _out: model.DomainValues;
    /// The promise
    _promise: Promise<webdb.Value[]> | null;

    constructor(stats: platform.TableStatistics, attribute: number, out: model.DomainValues) {
        super();
        this._statistics = stats;
        this._attribute = attribute;
        this._out = out;
        this._promise = null;
    }

    /// Request
    prepare() {
        this._promise = this._statistics.request(
            model.TableStatisticsType.DISTINCT_VALUES,
            this._attribute,
        );
    }

    /// Evaluate table statistics and update the domain spec
    async apply(): Promise<void> {
        const results = await this._promise!;
        const table = this._statistics.resolveTableInfo()!;
        const type = table.columnTypes[this._attribute];
        readDomainValues(type, [results[0]], this._out);
    }
}
