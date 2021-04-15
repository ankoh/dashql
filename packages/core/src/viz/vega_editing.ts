import * as platform from '../platform';
import * as model from '../model';
import * as arrow from 'apache-arrow';

export abstract class VegaLiteEditOperation {
    /// Prepare the completion
    abstract prepare(): void;
    /// Apply the edit operation
    abstract apply(): Promise<void>;
}

export class ResolveMinMaxDomain extends VegaLiteEditOperation {
    /// The statistics queue
    _statistics: platform.TableStatisticsResolver;
    /// The attribute id
    _attribute: number;
    /// The domain object
    _out: model.DomainValues;
    /// The promises
    _promises: Promise<arrow.Column>[];

    constructor(stats: platform.TableStatisticsResolver, attribute: number, out: model.DomainValues) {
        super();
        this._statistics = stats;
        this._out = out;
        this._attribute = attribute;
        this._promises = [];
    }

    /// Prepare the table statitistics
    prepare(): void {
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
        this._out[0] = results[0].get(0);
        this._out[1] = results[1].get(0);
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
    _promise: Promise<arrow.Column> | null;

    constructor(stats: platform.TableStatisticsResolver, attribute: number, out: model.DomainValues) {
        super();
        this._statistics = stats;
        this._attribute = attribute;
        this._out = out;
        this._promise = null;
    }

    /// Request
    prepare(): void {
        this._promise = this._statistics.request(model.TableStatisticsType.DISTINCT_VALUES, this._attribute);
    }

    /// Evaluate table statistics and update the domain spec
    async apply(): Promise<void> {
        this._out = (await this._promise!).toArray();
    }
}
