import * as proto from '@dashql/proto';
import * as model from '../model';
import * as platform from '../platform';
import * as v from 'vega';
import * as vl from 'vega-lite';
import * as vlt from 'vega-lite/build/src/transform';

import { VegaLiteEditOperation, ResolveMinMaxDomain } from './vega_editing';

import { AggregatedFieldDef } from 'vega-lite/build/src/transform';
import { Field, isScaleFieldDef, isFieldDef } from 'vega-lite/build/src/channeldef';
import { LayerSpec, NormalizedLayerSpec } from 'vega-lite/build/src/spec/layer';
import { LogicalComposition } from 'vega-lite/build/src/logical';
import { Predicate } from 'vega-lite/build/src/predicate';
import { SortField } from 'vega-lite/build/src/sort';
import { TopLevel } from 'vega-lite/build/src/spec/toplevel';
import { hasContinuousDomain } from 'vega-lite/build/src/scale';
import { isUnitSpec } from 'vega-lite/build/src/spec/unit';
import { normalize } from 'vega-lite/build/src/normalize';

export type VegaLiteTLLayerSpec = TopLevel<LayerSpec<Field>>;

const DEFAULT_SAMPLE_SIZE = 10000;

export class VizComposer {
    /// The platform
    _tableStatistics: platform.TableStatisticsResolver;

    /// The renderer type
    _renderer: model.VizRendererType | null = null;
    /// The query type
    _queryType: model.VizQueryType | null = model.VizQueryType.RESERVOIR_SAMPLE;
    /// The filters (if any)
    _filters: LogicalComposition<Predicate>[] = [];
    /// The aggregates
    _aggregates: AggregatedFieldDef[] = [];
    /// The data ordering (if any)
    _orderBy: SortField[] | null = null;
    /// The M4 X-attributes (if any)
    _m4AttributeX: string | null = null;
    /// The M4 Y-attributes (if any)
    _m4AttributeY: string | null = null;
    /// The M4 X-domain (if any)
    _m4DomainX: model.DomainValues = [];
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
    }

    /// Get the table
    protected get table() {
        return this._tableStatistics.resolveTableInfo()!;
    }

    /// Has a column?
    protected hasColumn(column: string): boolean {
        return this.table.columnNameMapping!.has(column);
    }

    /// Report that the component is invalid
    protected invalidComponent(type: proto.syntax.VizComponentType, modifiers: Map<proto.syntax.VizComponentTypeModifier, boolean>, options: any, reason: string) {
        console.error(reason);
    }

    /// Add a vega component
    protected addVegaComponent(type: proto.syntax.VizComponentType, modifiers: Map<proto.syntax.VizComponentTypeModifier, boolean>, options: any = null) {

        // XXX make smarter

        // Read field encoding
        const readFieldEncoding = (spec: any, field: string) => {
            if (typeof spec[field] === 'string' || spec[field] instanceof String) {
                return { field: field };
            } else {
                return spec.encoding?.[field];
            }
        };

        if (options != null) {
            this._inputVegaLiteSpec.transform?.push(...options.transform);
            this._inputVegaLiteSpec.layer.push({
                ...options,
                title: undefined,
                position: undefined,
                x: undefined,
                y: undefined,
                encoding: {
                    ...options.encoding,
                    x: readFieldEncoding(options, 'x'),
                    y: readFieldEncoding(options, 'y'),
                },
            });
        }
    }

    /// Analayze a single viz component
    public addComponent(type: proto.syntax.VizComponentType, modifiers: Map<proto.syntax.VizComponentTypeModifier, boolean>, options: any = null) {
        switch (type) {
            case proto.syntax.VizComponentType.VEGA:
            case proto.syntax.VizComponentType.AREA:
            case proto.syntax.VizComponentType.AXIS:
            case proto.syntax.VizComponentType.BAR:
            case proto.syntax.VizComponentType.BOX:
            case proto.syntax.VizComponentType.CANDLESTICK:
            case proto.syntax.VizComponentType.ERROR_BAR:
            case proto.syntax.VizComponentType.HISTOGRAM:
            case proto.syntax.VizComponentType.LINE:
            case proto.syntax.VizComponentType.PIE:
            case proto.syntax.VizComponentType.SCATTER:
            case proto.syntax.VizComponentType.VORONOI: {
                if (this._renderer != null && this._renderer != model.VizRendererType.BUILTIN_VEGA) {
                    this.invalidComponent(type, modifiers, options, 'viz component requires vega renderer');
                    return;
                }
                // XXX conflicts
                this._renderer = model.VizRendererType.BUILTIN_VEGA;
                this.addVegaComponent(type, modifiers, options);
                break;
            }
            case proto.syntax.VizComponentType.NUMBER:
            case proto.syntax.VizComponentType.TABLE: {
                if (this._renderer != null && this._renderer != model.VizRendererType.BUILTIN_TABLE) {
                    this.invalidComponent(type, modifiers, options, 'viz component requires vega table');
                    return;
                }
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
            if (this._queryType && this._queryType != forceQueryType) {
                // XXX Emit error
                console.error('Incompatible query type');
                break;
            }
            this._queryType = forceQueryType;
            this._sampleSize = forceSampleSize;
        }

        // Filter transforms
        spec.transform = spec.transform?.filter((t, i) => keepTransforms[i]);
    }

    protected analyzeVegaEncodings(spec: TopLevel<NormalizedLayerSpec>) {
        let table = this._tableStatistics.resolveTableInfo();

        // Use m4 data source?
        let useM4 = true;
        let m4AttributeX: string | null = null;
        let m4AttributeY: string | null = null;
        let m4DomainX: model.DomainValues = [];

        // Iterate over all layer specs
        for (const layer of spec.layer) {
            // Skip nested layers
            if (!isUnitSpec(layer)) {
                useM4 = false;
                continue;
            }

            // Check x encoding.
            // What about chart types with explicit x2 or inverted ones?
            const x = layer.encoding?.x;
            const y = layer.encoding?.y;
            let xID: number | null = null;
            let yID: number | null = null;
            if (x && y) {
                // Has field properties?
                if (isFieldDef(x) && isFieldDef(y) && x.field && y.field) {
                    useM4 &&= table?.columnNameMapping.has(x.field) || table?.columnNameMapping.has(y.field) || false;
                    if (useM4) {
                        m4AttributeX = x.field;
                        m4AttributeY = x.field;
                        m4DomainX = [];
                        xID = table?.columnNameMapping.get(x.field)!;
                        yID = table?.columnNameMapping.get(y.field)!;
                        const resolver = new ResolveMinMaxDomain(this._tableStatistics, xID, this._m4DomainX);
                        this._vegaLiteEditOps.push(resolver);
                    }
                }

                // Has exlicit X scale property?
                if (xID && isScaleFieldDef(x)) {
                    const scale = x.scale!;
                    const scaleType = scale.type;
                    useM4 &&= scaleType ? hasContinuousDomain(scaleType) : true;
                    if (!scale.domain) {
                        scale.domain = [];
                        const resolver = new ResolveMinMaxDomain(this._tableStatistics, xID, scale.domain);
                        this._vegaLiteEditOps.push(resolver);
                    }
                }

                // Has exlicit Y scale property?
                if (yID && isScaleFieldDef(y)) {
                    const scale = y.scale!;
                    if (!scale.domain) {
                        scale.domain = [];
                        const resolver = new ResolveMinMaxDomain(this._tableStatistics, yID, scale.domain);
                        this._vegaLiteEditOps.push(resolver);
                    }
                }
            }
        }

        // Use m4 sampling?
        if (useM4) {
            this._queryType = model.VizQueryType.M4;
            this._m4AttributeX = m4AttributeX;
            this._m4AttributeY = m4AttributeY;
            this._m4DomainX = m4DomainX;
        }
    }

    public combineComponents() {
        // Instrument vega spec?
        if (this._inputVegaLiteSpec) {
            this._normalizedVegaLiteSpec = normalize(this._inputVegaLiteSpec) as TopLevel<NormalizedLayerSpec>;
            this.analyzeVegaEncodings(this._normalizedVegaLiteSpec);
            this.analyzeVegaTransforms(this._normalizedVegaLiteSpec);
            this._vegaLiteEditOps.map(o => o.prepare());
        }
    }

    /// Compile the vega spec.
    protected async compileVegaSpec(spec: VegaLiteTLLayerSpec): Promise<v.Spec | null> {
        // Apply all edit operations (if any)
        const editPromises = this._vegaLiteEditOps.map(e => e.apply());
        await Promise.all(editPromises);
        this._vegaLiteEditOps = [];

        // Compile the spec
        return vl.compile(spec).spec;
    }

    /// Build the actual viz object that is passed to the renderer.
    /// The function is async since we may have to wait for database requests.
    public async buildViz(
        base: Pick<
            model.VizInfo,
            Exclude<
                keyof model.VizInfo,
                | 'timeCreated'
                | 'timeUpdated'
                | 'nameQualified'
                | 'nameShort'
                | 'renderer'
                | 'dataSource'
                | 'vegaLiteSpec'
                | 'vegaSpec'
            >
        >,
    ): Promise<model.VizInfo> {
        const table = this.table;
        const now = new Date();
        let vegaSpec = null;
        if (this._renderer == model.VizRendererType.BUILTIN_VEGA) {
            vegaSpec = await this.compileVegaSpec(this._normalizedVegaLiteSpec!);
        }
        return {
            ...base,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: table.nameQualified || '',
            nameShort: table.nameShort || '',
            renderer: this._renderer || model.VizRendererType.BUILTIN_TABLE,
            dataSource: {
                queryType: model.VizQueryType.RESERVOIR_SAMPLE,
                targetQualified: table.nameQualified,
                filters: this._filters || [],
                aggregates: this._aggregates || [],
                orderBy: this._orderBy || [],
                m4AttributeX: this._m4AttributeX,
                m4AttributeY: this._m4AttributeY,
                m4DomainX: this._m4DomainX || [],
                rowCount: null,
                sampleSize: 10000,
            },
            vegaLiteSpec: this._normalizedVegaLiteSpec,
            vegaSpec: vegaSpec,
        };
    }
}
