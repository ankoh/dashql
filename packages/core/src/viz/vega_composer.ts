import * as proto from '@dashql/proto';
import * as model from '../model';
import * as v from 'vega';
import { Type } from 'apache-arrow/enum';

import { TableStatisticsResolver } from '../table_statistics';
import { VegaLiteEditOperation, ResolveMinMaxDomain } from './vega_editing';

import * as vlt from 'vega-lite/build/src/transform';

import { compile as compileVL } from 'vega-lite/build/src/compile/compile';
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
import { normalize } from 'vega-lite/build/src/normalize/index';

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
    width: 'container',
    height: 'container',
    layer: [],
};

export class VegaComposer {
    /// The platform
    _tableStatistics: TableStatisticsResolver;

    /// The query type
    _dataResolver: model.CardDataResolver | null = null;
    /// The filters (if any)
    _filters: LogicalComposition<Predicate>[] | null = null;
    /// The aggregates
    _aggregates: AggregatedFieldDef[] | null = null;
    /// The data ordering (if any)
    _orderBy: SortField[] | null = null;
    /// The am4 X-attributes (if any)
    _am4Config: model.AM4Config | null = null;
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

    constructor(statistics: TableStatisticsResolver) {
        this._tableStatistics = statistics;
        this._inputVegaLiteSpec = {
            ...DEFAULT_VEGA_LITE_MIXINS,
            layer: [],
        };
    }

    /// Get the table
    protected get table(): model.TableMetadata {
        return this._tableStatistics.resolveTableMetadata()!;
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
    ): void {
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
        const resolveEncoding = (opt: any, field: string) => {
            // Specified directly as encoding?
            // E.g. the user wrote USING LINE (encoding = (x = _))
            const f = opt?.encoding?.[field];
            if (f) {
                // Specified as string?
                if (typeof f === 'string' || f instanceof String) return { field: f };
                // Assume the user gave us a valid encoding
                return opt.encoding?.[field];
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
    ): void {
        switch (type) {
            case proto.syntax.VizComponentType.SPEC: {
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
                this.generateVegaLayer(type, modifiers, options);
                break;
            }
            case proto.syntax.VizComponentType.TABLE:
            case proto.syntax.VizComponentType.JSON:
            case proto.syntax.VizComponentType.HEX: {
                console.error('unexpected component type in vega composer');
                // XXX Should not happen, throw an error
                break;
            }
        }
    }

    /// Analyze the vega transforms
    protected analyzeVegaTransforms(spec: TopLevel<NormalizedLayerSpec>): void {
        const keepTransforms: boolean[] = [];
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
            let forceQueryType: model.CardDataResolver | null = null;
            let forceSampleSize: number = DEFAULT_SAMPLE_SIZE;

            if (vlt.isAggregate(transform)) {
                // Can we push the grouping to the database?
                // Is the grouping a base attribute or the result of a computation?
                // We can only push the grouping to the database in the former case.

                // XXX For now, just stop rewriting
                // We should be smarter here very soon.

                noRewrites = true;
                forceQueryType = model.CardDataResolver.RESERVOIR_SAMPLE;
            } else if (vlt.isCalculate(transform)) {
                // We could push calulcate down to the database if when parsing the expression.
                // For now, we will just stop rewriting.
                noRewrites = true;
                forceQueryType = model.CardDataResolver.RESERVOIR_SAMPLE;
            } else if (vlt.isFilter(transform)) {
                // Filtering breaks with sampling.
                // We should push down the filter under the sampling.
                // Check if the attribute is simple enough.
                forceQueryType = model.CardDataResolver.RESERVOIR_SAMPLE;

                // XXX Check if filter expression can be pushed to SQL
            } else if (vlt.isTimeUnit(transform)) {
                // Time grouping?
                // We could do that in the database if the target field is not a transform.
                forceQueryType = model.CardDataResolver.RESERVOIR_SAMPLE;
            } else if (vlt.isSample(transform)) {
                // Adjust sample size
                forceQueryType = model.CardDataResolver.RESERVOIR_SAMPLE;
                forceSampleSize = transform.sample;
                keepTransforms[i] = false;
            }

            // Set query and sample size
            if (forceQueryType) {
                if (this._dataResolver && this._dataResolver != forceQueryType) {
                    // XXX Emit error
                    console.error('Incompatible data resolver');
                    break;
                }
                this._dataResolver = forceQueryType;
            }
            this._sampleSize = forceSampleSize;
        }

        // Filter transforms
        spec.transform = spec.transform?.filter((t, i) => keepTransforms[i]);
        if (!spec.transform) delete spec.transform;
    }

    /// Analyze the vega encodings
    protected analyzeVegaEncodings(spec: TopLevel<NormalizedLayerSpec>): void {
        const table = this._tableStatistics.resolveTableMetadata()!;

        // Analyze the field type
        const analyzeFieldType = (enc: any, columnID: number) => {
            if (!isTypedFieldDef(enc)) {
                switch (table.columnTypes[columnID].typeId) {
                    case Type.Int:
                    case Type.Float:
                    case Type.Decimal:
                    case Type.Bool:
                        enc.type = 'quantitative';
                        break;

                    case Type.Utf8:
                        enc.type = 'nominal';
                        break;

                    case Type.Date:
                    case Type.Time:
                    case Type.Timestamp:
                    case Type.Interval:
                        enc.type = 'temporal';
                        break;

                    default:
                        break;
                }
            }
        };

        // Helper to analyze a scale definition
        const analyzeScale = (enc: any, columnID: number) => {
            // Does not define a scale?
            if (!isScaleFieldDef(enc)) enc.scale = {};
            const scale = enc.scale!;

            // Resolve domain?
            if (!scale.domain) {
                switch (enc.type) {
                    case 'temporal': {
                        scale.domain = [];
                        const resolver = new ResolveMinMaxDomain(this._tableStatistics, columnID, scale.domain);
                        this._vegaLiteEditOps.push(resolver);
                        break;
                    }
                    case 'quantitative': {
                        scale.domain = [];
                        const resolver = new ResolveMinMaxDomain(this._tableStatistics, columnID, scale.domain);
                        this._vegaLiteEditOps.push(resolver);
                        break;
                    }
                }
            }
        };

        // Run general optimizations accross all layers
        for (const layer of spec.layer) {
            // Skip nested layers
            if (!isUnitSpec(layer)) continue;

            // Optimize encodings
            for (const [, enc] of Object.entries(layer.encoding || {})) {
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

    /// Switch query type to am4 if the spec allows it
    public useAM4IfPossible(spec: TopLevel<NormalizedLayerSpec>): void {
        const table = this._tableStatistics.resolveTableMetadata()!;

        // Use am4 data source?
        let preferAM4 = false;
        let canUseAM4 = true;
        let am4Config: model.AM4Config | null = null;

        // Iterate over all layer specs
        for (const layer of spec.layer) {
            // Skip nested layers
            if (!isUnitSpec(layer)) {
                canUseAM4 = false;
                continue;
            }

            const x = layer.encoding?.x;
            const y = layer.encoding?.y;
            if (x && y && isFieldDef(x) && isFieldDef(y) && x.field && y.field) {
                //
                if (x.type === 'quantitative' && y.type === 'quantitative') {
                    preferAM4 = true;
                }

                // Has exlicit X scale property?
                if (x.scale && x.scale.type) {
                    const scale = x.scale!;
                    const scaleType = scale.type;
                    canUseAM4 &&= scaleType ? hasContinuousDomain(scaleType) : true;
                    preferAM4 ||= canUseAM4;
                }

                // Has exlicit Y scale property?
                if (y.scale && y.scale.type) {
                    const scale = x.scale!;
                    const scaleType = scale.type;
                    canUseAM4 &&= scaleType ? hasContinuousDomain(scaleType) : true;
                    preferAM4 ||= canUseAM4;
                }

                // Has field properties?
                canUseAM4 &&= table.columnNameMapping.has(x.field) || table!.columnNameMapping.has(y.field) || false;
                if (canUseAM4) {
                    am4Config = {
                        attributeX: x.field!,
                        attributeY: y.field!,
                        domainX: [],
                    };
                    const xID = table.columnNameMapping.get(x.field)!;
                    const resolver = new ResolveMinMaxDomain(this._tableStatistics, xID, am4Config.domainX);
                    this._vegaLiteEditOps.push(resolver);
                }
            }
        }

        // Use am4 sampling?
        if (preferAM4 && canUseAM4) {
            this._dataResolver = model.CardDataResolver.AM4;
            this._am4Config = am4Config;
        }
    }

    public combineComponents(): void {
        // Instrument vega spec?
        if (this._inputVegaLiteSpec) {
            this._normalizedVegaLiteSpec = normalize(this._inputVegaLiteSpec) as TopLevel<NormalizedLayerSpec>;
            this.analyzeVegaEncodings(this._normalizedVegaLiteSpec);
            this.analyzeVegaTransforms(this._normalizedVegaLiteSpec);
            this.useAM4IfPossible(this._normalizedVegaLiteSpec);
            this._vegaLiteEditOps.map(o => o.prepare());
        }
    }

    /// Compile the vega spec.
    protected async compileVegaSpec(spec: VegaLiteTLLayerSpec): Promise<v.Spec | null> {
        // Apply all edit operations (if any)
        const editPromises = this._vegaLiteEditOps.map(e => e.apply());
        this._vegaLiteEditOps = [];
        await Promise.all(editPromises);
        return compileVL(spec).spec;
    }

    /// Build the actual viz object that is passed to the renderer.
    /// The function is async since we may have to wait for database requests.
    public async compile(): Promise<
        Pick<model.CardSpecification, 'cardRenderer' | 'dataSource' | 'vegaLiteSpec' | 'vegaSpec'>
    > {
        const table = this.table;
        let vegaSpec = null;
        try {
            vegaSpec = await this.compileVegaSpec(this._normalizedVegaLiteSpec!);
        } catch (e) {
            console.warn(e);
        }
        return {
            cardRenderer: model.CardRendererType.BUILTIN_VEGA,
            dataSource: {
                dataResolver: this._dataResolver || model.CardDataResolver.RESERVOIR_SAMPLE,
                targetQualified: table.nameQualified,
                filters: this._filters,
                aggregates: this._aggregates,
                orderBy: this._orderBy,
                am4Config: this._am4Config,
                sampleSize: 10000,
            },
            vegaLiteSpec: this._normalizedVegaLiteSpec,
            vegaSpec: vegaSpec,
        };
    }
}
