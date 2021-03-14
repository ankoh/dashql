import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as platform from '../platform';
import * as v from 'vega';
import * as vl from 'vega-lite';
import * as vlt from 'vega-lite/src/transform';

import { VegaLiteEditOperation, ResolveMinMaxDomain } from './vega_editing';

import { AggregatedFieldDef } from 'vega-lite/src/transform';
import { Field, isScaleFieldDef, isFieldDef } from 'vega-lite/src/channeldef';
import { LayerSpec, NormalizedLayerSpec } from 'vega-lite/src/spec/layer';
import { LogicalComposition } from 'vega-lite/src/logical';
import { NormalizedSpec } from 'vega-lite/src/spec';
import { Predicate } from 'vega-lite/src/predicate';
import { SortField } from 'vega-lite/src/sort';
import { TopLevel } from 'vega-lite/src/spec/toplevel';
import { hasContinuousDomain } from 'vega-lite/src/scale';
import { isUnitSpec } from 'vega-lite/src/spec/unit';
import { normalize } from 'vega-lite/src/normalize';

export type VegaLiteTLLayerSpec = TopLevel<LayerSpec<Field>>;

const DEFAULT_SAMPLE_SIZE = 10000;

export class VizComposer {
    /// The platform
    _database: platform.DatabaseManager;
    /// The table info (when fetched)
    _tableName: string;

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
    _m4Domain: model.DomainValues = [];
    /// The row count (if known)
    _rowCount: number | null = null;
    /// The max sample size (if any)
    _sampleSize: number | null = null;

    /// The vega-lite spec.
    /// We only want to construct layer specs here.
    _inputVegaLiteSpec: TopLevel<LayerSpec<Field>> | null = null;
    /// The normalized vega-lite spec
    _normalizedVegaLiteSpec: TopLevel<NormalizedLayerSpec> | null = null;
    /// The vega-lite edit ops
    _vegaLiteEditOps: VegaLiteEditOperation[] = [];
    /// The vega spec
    _vegaSpec: v.Spec | null = null;

    constructor(database: platform.DatabaseManager, tableName: string) {
        this._database = database;
        this._tableName = tableName;
    }

    /// Get the table
    protected get table() {
        const stats = this._database.resolveTableStatistics(this._tableName)!;
        return stats.resolveTableInfo()!;
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
            this._inputVegaLiteSpec = {
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
        let table = this._database.resolveTableInfo(this._tableName);
        let stats = this._database.resolveTableStatistics(this._tableName)!;

        // Use m4 data source?
        let useM4 = true;
        let m4Attribute: string | null = null;
        let m4Domain: model.DomainValues = [];

        // Iterate over all layer specs
        for (const layer of spec.layer) {
            // Skip nested layers
            if (!isUnitSpec(layer)) {
                useM4 = false;
                continue;
            }

            // Check x encoding.
            // Sufficient to check only X here? Likely not.
            // What about chart types with explicit x2 or inverted ones?
            const x = layer.encoding?.x;
            let xID: number | null = null;
            if (x) {
                // Has field property?
                if (isFieldDef(x) && x.field) {
                    const isBaseAttribute = table?.columnNameMapping.has(x.field) || false;
                    useM4 &&= isBaseAttribute;

                    // Is field a plain data column?
                    if (useM4) {
                        m4Attribute = x.field;
                        m4Domain = [];
                        xID = table?.columnNameMapping.get(x.field)!;
                        const resolver = new ResolveMinMaxDomain(stats, xID, this._m4Domain);
                        this._vegaLiteEditOps.push(resolver);
                    }
                }

                // Has exlicit scale property?
                if (xID && isScaleFieldDef(x)) {
                    const scale = x.scale!;
                    const scaleType = scale.type;
                    useM4 &&= scaleType ? hasContinuousDomain(scaleType) : true;

                    // Try to resolve the domain for the user
                    if (!scale.domain) {
                        scale.domain = [];
                        const resolver = new ResolveMinMaxDomain(stats, xID, scale.domain);
                        this._vegaLiteEditOps.push(resolver);
                    }
                }
            }
        }

        // Use m4 sampling?
        if (useM4) {
            this._queryType = model.VizQueryType.M4;
            this._m4Attribute = m4Attribute;
            this._m4Domain = m4Domain;
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
                predicates: this._predicates || [],
                aggregates: this._aggregates || [],
                orderBy: this._orderBy || [],
                m4Attribute: this._m4Attribute,
                m4Domain: this._m4Domain || [],
                rowCount: null,
                sampleSize: 10000,
            },
            vegaLiteSpec: this._normalizedVegaLiteSpec,
            vegaSpec: vegaSpec,
        };
    }
}
