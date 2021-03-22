import * as proto from '@dashql/proto';
import * as model from '../model';
import * as error from '../error';
import * as platform from '../platform';
import * as v from 'vega';
import * as vl from 'vega-lite';
import * as vlt from 'vega-lite/build/src/transform';

import { VegaLiteEditOperation, ResolveMinMaxDomain } from './vega_editing';

import { AggregatedFieldDef } from 'vega-lite/build/src/transform';
import { Field, isScaleFieldDef, isFieldDef, isTypedFieldDef } from 'vega-lite/build/src/channeldef';
import { LayerSpec, NormalizedLayerSpec } from 'vega-lite/build/src/spec/layer';
import { LogicalComposition } from 'vega-lite/build/src/logical';
import { Predicate } from 'vega-lite/build/src/predicate';
import { SortField } from 'vega-lite/build/src/sort';
import { Encoding } from 'vega-lite/build/src/encoding';
import { TopLevel } from 'vega-lite/build/src/spec/toplevel';
import { hasContinuousDomain } from 'vega-lite/build/src/scale';
import { isUnitSpec, UnitSpec } from 'vega-lite/build/src/spec/unit';
import { normalize } from 'vega-lite/build/src/normalize';
import { defaultBarConfig } from 'vega-lite/build/src/mark';

export type VegaLiteTLLayerSpec = TopLevel<LayerSpec<Field>>;

const DEFAULT_SAMPLE_SIZE = 10000;
export const DEFAULT_VEGA_LITE_MIXINS: VegaLiteTLLayerSpec = {
    autosize: {
        type: 'fit',
        contains: 'padding',
        resize: true,
    },
    title: undefined,
    background: 'transparent',
    padding: 8,
    layer: [],
};

export class VizComposer {
    /// The platform
    _tableStatistics: platform.TableStatisticsResolver;

    /// The renderer type
    _renderer: model.VizRendererType | null = null;
    /// The query type
    _queryType: model.VizQueryType | null = null;
    /// The filters (if any)
    _filters: LogicalComposition<Predicate>[] | null = null;
    /// The aggregates
    _aggregates: AggregatedFieldDef[] | null = null;
    /// The data ordering (if any)
    _orderBy: SortField[] | null = null;
    /// The M5 X-attributes (if any)
    _m5Config: model.M5Config | null = null;
    /// The row count (if known)
    _rowCount: number | null = null;
    /// The max sample size (if any)
    _sampleSize: number | null = null;

    /// The vega-lite spec.
    /// We only want to construct layer specs here.
    _inputVegaLiteSpec: TopLevel<LayerSpec<Field>>;
    /// The normalized vega-lite spec
    _normalizedVegaLiteSpec: TopLevel<NormalizedLayerSpec> | null = null;
    /// The vega-lite edit ops
    _vegaLiteEditOps: VegaLiteEditOperation[] = [];
    /// The vega spec
    _vegaSpec: v.Spec | null = null;

    constructor(statistics: platform.TableStatisticsResolver) {
        this._tableStatistics = statistics;
        this._inputVegaLiteSpec = {
            ...DEFAULT_VEGA_LITE_MIXINS,
            layer: [],
        };
    }

    /// Get the table
    protected get table() {
        return this._tableStatistics.resolveTableInfo()!;
    }

    /// Has a column?
    protected hasColumn(column: string): boolean {
        return this.table.columnNameMapping!.has(column);
    }

    /// Generate a vega layer
    protected generateVegaLayer(
        type: proto.syntax.VizComponentType,
        modifiers: Map<proto.syntax.VizComponentTypeModifier, boolean>,
        options: any = null,
    ) {
        /// Otherwise build the vega layer manually
        const layer: UnitSpec<Field> = {
            ...options,
            encoding: {},

            // Clear all attributes that we subsumed
            transform: undefined,
            title: undefined,
            position: undefined,
            x: undefined,
            y: undefined,
            color: undefined,
            shape: undefined,
            size: undefined,
            theta: undefined,
            radius: undefined,
        };

        // First collect the encodings that the user specified himself
        const encoding: Encoding<Field> = layer.encoding!;
        const resolveEncoding = (options: any, field: string) => {
            // Specified directly as encoding?
            // E.g. the user wrote USING LINE (encoding = (x = _))
            const f = options?.encoding?.[field];
            if (f) {
                // Specified as string?
                if (typeof f === 'string' || f instanceof String) return { field: f };
                // Assume the user gave us a valid encoding
                return options.encoding?.[field];
            }
            // Is there a column with that name?
            if (this.table.columnNameMapping.has(field)) {
                return { field: field };
            }
            // Otherwise mark it as undefined
            return undefined;
        };
        switch (type) {
            case proto.syntax.VizComponentType.AREA:
            case proto.syntax.VizComponentType.LINE:
            case proto.syntax.VizComponentType.SCATTER:
            case proto.syntax.VizComponentType.BAR:
                encoding.x = resolveEncoding(options, 'x');
                encoding.x2 = resolveEncoding(options, 'x2');
                encoding.y = resolveEncoding(options, 'y');
                encoding.color = resolveEncoding(options, 'color');
                encoding.shape = resolveEncoding(options, 'shape');
                encoding.size = resolveEncoding(options, 'size');
                break;
            case proto.syntax.VizComponentType.PIE:
                encoding.theta = resolveEncoding(options, 'theta');
                encoding.radius = resolveEncoding(options, 'radius');
                encoding.shape = resolveEncoding(options, 'shape');
                encoding.size = resolveEncoding(options, 'size');
                break;
            default:
                break;
        }

        // Read specific options
        switch (type) {
            case proto.syntax.VizComponentType.AREA:
                layer.mark = 'area';
                break;
            case proto.syntax.VizComponentType.LINE:
                layer.mark = 'line';
                break;
            case proto.syntax.VizComponentType.SCATTER:
                layer.mark = 'point';
                break;
            case proto.syntax.VizComponentType.BAR:
                layer.mark = 'bar';
                break;
            case proto.syntax.VizComponentType.PIE:
                layer.mark = 'arc';
                break;
            default:
                break;
        }

        // Remove undefined attributes since vega complains about them
        const clean = layer as any;
        Object.keys(clean).forEach(key => (clean[key] === undefined ? delete clean[key] : {}));
        Object.keys(clean.encoding).forEach(key =>
            clean.encoding[key] === undefined ? delete clean.encoding[key] : {},
        );

        // Store as vega lite layer
        this._inputVegaLiteSpec.transform?.push(...options.transform);
        this._inputVegaLiteSpec.layer.push(clean);
    }

    /// Analayze a single viz component
    public addComponent(
        type: proto.syntax.VizComponentType,
        modifiers: Map<proto.syntax.VizComponentTypeModifier, boolean>,
        options: any = null,
    ) {
        const useRenderer = (renderer: model.VizRendererType) => {
            if (this._renderer != null && this._renderer != model.VizRendererType.BUILTIN_VEGA) {
                // XXX log warning
            }
            this._renderer = renderer;
        };
        switch (type) {
            case proto.syntax.VizComponentType.VEGA: {
                useRenderer(model.VizRendererType.BUILTIN_VEGA);
                this._inputVegaLiteSpec.transform = options.transform;
                const layer = { ...options };
                delete layer.transform;
                delete layer.title;
                delete layer.position;
                this._inputVegaLiteSpec.layer = [layer];
                break;
            }
            case proto.syntax.VizComponentType.AREA:
            case proto.syntax.VizComponentType.AXIS:
            case proto.syntax.VizComponentType.BAR:
            case proto.syntax.VizComponentType.BOX:
            case proto.syntax.VizComponentType.CANDLESTICK:
            case proto.syntax.VizComponentType.ERROR_BAR:
            case proto.syntax.VizComponentType.LINE:
            case proto.syntax.VizComponentType.PIE:
            case proto.syntax.VizComponentType.SCATTER: {
                useRenderer(model.VizRendererType.BUILTIN_VEGA);
                this.generateVegaLayer(type, modifiers, options);
                break;
            }
            case proto.syntax.VizComponentType.TABLE: {
                useRenderer(model.VizRendererType.BUILTIN_TABLE);
                // XXX conflicts
                this._renderer = model.VizRendererType.BUILTIN_TABLE;
                break;
            }
        }
    }

    /// Analyze the vega transforms
    protected analyzeVegaTransforms(spec: TopLevel<NormalizedLayerSpec>) {
        let keepTransforms: boolean[] = [];
        let noRewrites = false;

        for (let i = 0; i < (spec.transform?.length || 0); ++i) {
            const transform = spec.transform![i];
            keepTransforms.push(true);

            // Is unsupported transform?
            // Opt out from rewriting the spec and feed vega with default table sample.
            noRewrites =
                noRewrites ||
                vlt.isBin(transform) ||
                vlt.isDensity(transform) ||
                vlt.isFlatten(transform) ||
                vlt.isFold(transform) ||
                vlt.isImpute(transform) ||
                vlt.isJoinAggregate(transform) ||
                vlt.isLoess(transform) ||
                vlt.isLookup(transform) ||
                vlt.isPivot(transform) ||
                vlt.isQuantile(transform) ||
                vlt.isRegression(transform) ||
                vlt.isStack(transform) ||
                vlt.isWindow(transform) ||
                false;
            if (noRewrites) break;

            // Force properties?
            let forceQueryType: model.VizQueryType | null = null;
            let forceSampleSize: number = DEFAULT_SAMPLE_SIZE;

            if (vlt.isAggregate(transform)) {
                // Can we push the grouping to the database?
                // Is the grouping a base attribute or the result of a computation?
                // We can only push the grouping to the database in the former case.

                // XXX For now, just stop rewriting
                // We should be smarter here very soon.

                noRewrites = true;
                forceQueryType = model.VizQueryType.RESERVOIR_SAMPLE;
            } else if (vlt.isCalculate(transform)) {
                // We could push calulcate down to the database if when parsing the expression.
                // For now, we will just stop rewriting.
                noRewrites = true;
                forceQueryType = model.VizQueryType.RESERVOIR_SAMPLE;
            } else if (vlt.isFilter(transform)) {
                // Filtering breaks with sampling.
                // We should push down the filter under the sampling.
                // Check if the attribute is simple enough.
                forceQueryType = model.VizQueryType.RESERVOIR_SAMPLE;

                // XXX Check if filter expression can be pushed to SQL
            } else if (vlt.isTimeUnit(transform)) {
                // Time grouping?
                // We could do that in the database if the target field is not a transform.
                forceQueryType = model.VizQueryType.RESERVOIR_SAMPLE;
            } else if (vlt.isSample(transform)) {
                // Adjust sample size
                forceQueryType = model.VizQueryType.RESERVOIR_SAMPLE;
                forceSampleSize = transform.sample;
                keepTransforms[i] = false;
            }

            // Set query and sample size
            if (forceQueryType) {
                if (this._queryType && this._queryType != forceQueryType) {
                    // XXX Emit error
                    console.error('Incompatible query type');
                    break;
                }
                this._queryType = forceQueryType;
            }
            this._sampleSize = forceSampleSize;
        }

        // Filter transforms
        spec.transform = spec.transform?.filter((t, i) => keepTransforms[i]);
        if (!spec.transform) delete spec.transform;
    }

    /// Analyze the vega encodings
    protected analyzeVegaEncodings(spec: TopLevel<NormalizedLayerSpec>) {
        const table = this._tableStatistics.resolveTableInfo()!;

        // Helper to analyze a scale definition
        const analyzeScale = (enc: any, columnID: number) => {
            // Does not define a scale?
            if (!isScaleFieldDef(enc)) enc.scale = {};
            const scale = enc.scale!;

            // Resolve domain?
            if (!scale.domain) {
                scale.domain = [];
                const resolver = new ResolveMinMaxDomain(this._tableStatistics, columnID, scale.domain);
                this._vegaLiteEditOps.push(resolver);
            }
        };

        // Analyze the field type
        const analyzeFieldType = (enc: any, columnID: number) => {
            if (!isTypedFieldDef(enc)) {
                switch (table.columnTypes[columnID].typeId) {
                    case proto.webdb.SQLTypeID.BOOLEAN:
                    case proto.webdb.SQLTypeID.BIGINT:
                    case proto.webdb.SQLTypeID.HUGEINT:
                    case proto.webdb.SQLTypeID.TINYINT:
                    case proto.webdb.SQLTypeID.SMALLINT:
                    case proto.webdb.SQLTypeID.INTEGER:
                    case proto.webdb.SQLTypeID.FLOAT:
                    case proto.webdb.SQLTypeID.DOUBLE:
                    case proto.webdb.SQLTypeID.DECIMAL:
                        enc.type = 'quantitative';
                        break;

                    case proto.webdb.SQLTypeID.CHAR:
                    case proto.webdb.SQLTypeID.VARCHAR:
                        enc.type = 'nominal';
                        break;

                    case proto.webdb.SQLTypeID.DATE:
                    case proto.webdb.SQLTypeID.TIME:
                    case proto.webdb.SQLTypeID.TIMESTAMP:
                    case proto.webdb.SQLTypeID.INTERVAL:
                        enc.type = 'temporal';
                        break;

                    default:
                        break;
                }
            }
        };

        // Run general optimizations accross all layers
        for (const layer of spec.layer) {
            // Skip nested layers
            if (!isUnitSpec(layer)) continue;

            // Optimize encodings
            for (const [_key, enc] of Object.entries(layer.encoding || {})) {
                // Defines a field?
                if (isFieldDef(enc) && enc.field) {
                    const fieldName = enc.field.toString();
                    const columnID = table.columnNameMapping.get(fieldName);
                    if (columnID != undefined && columnID != null) {
                        analyzeFieldType(enc, columnID);
                        analyzeScale(enc, columnID);
                    }
                }
            }
        }
    }

    /// Switch query type to M5 if the spec allows it
    public useM5IfPossible(spec: TopLevel<NormalizedLayerSpec>) {
        const table = this._tableStatistics.resolveTableInfo()!;

        // Use m5 data source?
        let useM5 = true;
        let m5Config: model.M5Config | null = null;

        // Iterate over all layer specs
        for (const layer of spec.layer) {
            // Skip nested layers
            if (!isUnitSpec(layer)) {
                useM5 = false;
                continue;
            }

            const x = layer.encoding?.x;
            const y = layer.encoding?.y;
            if (x && y && isFieldDef(x) && isFieldDef(y) && x.field && y.field) {
                // Has exlicit X scale property?
                if (isScaleFieldDef(x)) {
                    const scale = x.scale!;
                    const scaleType = scale.type;
                    useM5 &&= scaleType ? hasContinuousDomain(scaleType) : true;
                }

                // Has exlicit Y scale property?
                if (isScaleFieldDef(y)) {
                    const scale = x.scale!;
                    const scaleType = scale.type;
                    useM5 &&= scaleType ? hasContinuousDomain(scaleType) : true;
                }

                // Has field properties?
                useM5 &&= table.columnNameMapping.has(x.field) || table!.columnNameMapping.has(y.field) || false;
                if (useM5) {
                    m5Config = {
                        attributeX: x.field!,
                        attributeY: y.field!,
                        domainX: [],
                    };
                    const xID = table.columnNameMapping.get(x.field)!;
                    const resolver = new ResolveMinMaxDomain(this._tableStatistics, xID, m5Config.domainX);
                    this._vegaLiteEditOps.push(resolver);
                }
            }
        }

        // Use m5 sampling?
        if (useM5) {
            this._queryType = model.VizQueryType.M5;
            this._m5Config = m5Config;
        }
    }

    public combineComponents() {
        // Instrument vega spec?
        if (this._inputVegaLiteSpec) {
            this._normalizedVegaLiteSpec = normalize(this._inputVegaLiteSpec) as TopLevel<NormalizedLayerSpec>;
            this.analyzeVegaEncodings(this._normalizedVegaLiteSpec);
            this.analyzeVegaTransforms(this._normalizedVegaLiteSpec);
            this.useM5IfPossible(this._normalizedVegaLiteSpec);
            this._vegaLiteEditOps.map(o => o.prepare());
        }
    }

    /// Compile the vega spec.
    protected async compileVegaSpec(spec: VegaLiteTLLayerSpec): Promise<v.Spec | null> {
        // Apply all edit operations (if any)
        const editPromises = this._vegaLiteEditOps.map(e => e.apply());
        this._vegaLiteEditOps = [];
        await Promise.all(editPromises);
        return vl.compile(spec).spec;
    }

    /// Build the actual viz object that is passed to the renderer.
    /// The function is async since we may have to wait for database requests.
    public async compile(): Promise<Pick<model.VizInfo, 'renderer' | 'dataSource' | 'vegaLiteSpec' | 'vegaSpec'>> {
        const table = this.table;
        const now = new Date();
        let vegaSpec = null;
        if (this._renderer == model.VizRendererType.BUILTIN_VEGA) {
            vegaSpec = await this.compileVegaSpec(this._normalizedVegaLiteSpec!);
        }
        return {
            renderer: this._renderer || model.VizRendererType.BUILTIN_TABLE,
            dataSource: {
                queryType: this._queryType || model.VizQueryType.RESERVOIR_SAMPLE,
                targetQualified: table.tableNameQualified,
                filters: this._filters,
                aggregates: this._aggregates,
                orderBy: this._orderBy,
                m5Config: this._m5Config,
                rowCount: null,
                sampleSize: 10000,
            },
            vegaLiteSpec: this._normalizedVegaLiteSpec,
            vegaSpec: vegaSpec,
        };
    }
}
