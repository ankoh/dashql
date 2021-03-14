import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as platform from '../platform';
import * as v from 'vega';
import * as vl from 'vega-lite';
import * as vlt from 'vega-lite/src/transform';

import { VegaLiteEditOperation } from './vega_editing';
import { TopLevel } from 'vega-lite/src/spec/toplevel';
import { LayerSpec } from 'vega-lite/src/spec/layer';
import { UnitSpec } from 'vega-lite/src/spec/unit';
import { Field } from 'vega-lite/src/channeldef';
import { Transform, AggregatedFieldDef } from 'vega-lite/src/transform';
import { Mark } from 'vega-lite/src/mark';
import { values } from 'vega-lite/src/compile/axis/properties';
import { LogicalComposition } from 'vega-lite/src/logical';
import { Predicate } from 'vega-lite/src/predicate';
import { SortField } from 'vega-lite/src/sort';
import { TableStatistics } from '../platform';

export type VegaLiteTLLayerSpec = TopLevel<LayerSpec<Field>>;

const DEFAULT_SAMPLE_SIZE = 10000;

export class VizComposer {
    /// The table info (when fetched)
    _tableName: string;
    /// The table st
    _tableStatistics: platform.TableStatistics;

    /// The renderer type
    _renderer: model.VizRendererType | null = null;
    /// The query type
    _queryType: model.VizQueryType | null = model.VizQueryType.RESERVOIR_SAMPLE;
    /// The predicates (if any)
    _predicates: LogicalComposition<Predicate>[] = [];
    /// The aggregates
    _aggregates: AggregatedFieldDef[] = [];
    /// The data ordering (if any)
    _orderBy: SortField[] | null = null;
    /// The M4 attributes (if any)
    _m4Attribute: string | null = null;
    /// The M4 domain (if any)
    _m4Domain: webdb.Value[] = [];
    /// The row count (if known)
    _rowCount: number | null = null;
    /// The max sample size (if any)
    _sampleSize: number | null = null;

    /// The vega-lite spec.
    /// We only want to construct layer specs here.
    _vegaLiteSpec: VegaLiteTLLayerSpec | null = null;
    /// The vega-lite edit ops
    _vegaLiteEditOps: VegaLiteEditOperation[] = [];
    /// The vega spec
    _vegaSpec: v.Spec | null = null;

    constructor(tableName: string, statistics: platform.TableStatistics) {
        this._tableName = tableName;
        this._tableStatistics = statistics;
    }

    /// Get the table
    protected get table() {
        return this._tableStatistics.resolveTableInfo(this._tableName)!;
    }

    /// Has a column?
    protected hasColumn(column: string): boolean {
        return this.table.columnNameMapping!.has(column);
    }

    /// Report that the component is invalid
    protected invalidComponent(component: proto.analyzer.VizComponent, reason: string) {
        console.error(reason);
    }

    /// Analayze a single viz component
    public addComponent(component: proto.analyzer.VizComponent) {
        // Collect type
        const type = component.type()!;
        let typeModifiers: Map<proto.syntax.VizComponentTypeModifier, boolean> = new Map();
        for (let i = 0; i < component.typeModifiersLength(); ++i) {
            typeModifiers.set(component.typeModifiers(i)!, true);
        }

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
                    this.invalidComponent(component, 'viz component requires vega renderer');
                    return;
                }
                // XXX conflicts
                this._renderer = model.VizRendererType.BUILTIN_VEGA;
                break;
            }
            case proto.syntax.VizComponentType.NUMBER:
            case proto.syntax.VizComponentType.TABLE: {
                if (this._renderer != null && this._renderer != model.VizRendererType.BUILTIN_TABLE) {
                    this.invalidComponent(component, 'viz component requires vega table');
                    return;
                }
                // XXX conflicts
                this._renderer = model.VizRendererType.BUILTIN_TABLE;
                break;
            }
        }

        // TODO This is literally doing nothing smart at the moment.
        //      Let there be fancy vega autogen logic.

        const rawSpec = component.componentSpec();
        if (rawSpec != null) {
            let spec = JSON.parse(rawSpec);
            // XXX
            this._vegaLiteSpec = {
                ...spec,
                autosize: {
                    type: 'fit',
                    contains: 'padding',
                    resize: true,
                },
                title: undefined,
                background: 'transparent',
                padding: 8,
            };
        }
    }

    /// Analyze the vega transforms
    protected analyzeVegaTransforms(spec: VegaLiteTLLayerSpec) {
        let keepTransforms = [];
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
                if (transform.groupby) {
                }
                for (const agg of transform.aggregate) {
                    // XXX
                }

                // XXX For now, just stop rewriting
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
        }


        // XXX request all table statistics that we will need

        // XXX Create edit ops

        // Prepare all edit operations
        this._vegaLiteEditOps.forEach(e => e.prepare());
    }

    protected analyzeVegaEncodings(spec: VegaLiteTLLayerSpec) {
        // Iterate over all layer specs
        for (const layer of spec.layer) {
            // XXX detect nesting
            const unit = layer as UnitSpec<Field>;

            const mark = unit.mark;
            const encoding = layer.encoding;

            if (encoding === undefined) continue;
            const order = encoding.order;

            for (const key in unit.encoding) {
            }
        }
    }

    public combineComponents() {
        // Instrument vega spec?
        if (this._vegaLiteSpec) {
            this.analyzeVegaEncodings(this._vegaLiteSpec);
            this.analyzeVegaTransforms(this._vegaLiteSpec);
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
                | 'data'
                | 'vegaLiteSpec'
                | 'vegaSpec'
            >
        >,
    ): Promise<model.VizInfo> {
        const table = this.table;
        const now = new Date();
        let vegaSpec = null;
        if (this._renderer == model.VizRendererType.BUILTIN_VEGA) {
            vegaSpec = await this.compileVegaSpec(this._vegaLiteSpec!);
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
                predicates: this._predicates || [],
                aggregates: this._aggregates || [],
                orderBy: this._orderBy || [],
                m4Attribute: this._m4Attribute,
                m4Domain: this._m4Domain || [],
                rowCount: null,
                sampleSize: 10000,
            },
            vegaLiteSpec: this._vegaLiteSpec,
            vegaSpec: vegaSpec,
        };
    }
}
