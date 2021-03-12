import * as proto from '@dashql/proto';
import * as model from '../model';
import * as platform from '../platform';
import * as v from 'vega';
import * as vl from 'vega-lite';

export class VizComposer {
    /// The platform
    _platform: platform.Platform;
    /// The plan
    _plan: model.Plan;
    /// The table info (when fetched)
    _table: model.DatabaseTableInfo;

    /// The renderer type
    _renderer: model.VizRendererType | null = null;

    /// The required columns
    _requiredColumnIds: Map<string, number> = new Map();
    /// The required column list
    _requiredColumns: string[] = [];
    /// The data ordering (if any)
    _orderBy: string[] | null = null;
    /// The data partitioning (if any)
    _partitionBy: string[] | null = null;

    /// The vega-lite spec
    _vegaLiteSpec: vl.TopLevelSpec | null = null;
    /// The vega spec
    _vegaSpec: v.Spec | null = null;

    constructor(platform: platform.Platform, plan: model.Plan, table: model.DatabaseTableInfo) {
        this._platform = platform;
        this._plan = plan;
        this._table = table;
    }

    /// Has a column?
    protected hasColumn(column: string): boolean {
        return this._table.columnNameMapping!.has(column);
    }

    /// Require a column
    protected requireColumn(name: string) {
        if (!this._requiredColumnIds.has(name)) {
            this._requiredColumnIds.set(name, this._requiredColumns.length);
            this._requiredColumns.push(name);
        }
    }

    /// Resolve a column id by name
    protected resolveColumnId(name: string) {
        return this._requiredColumnIds.get(name)!;
    }

    /// Merge the user-provided data into a vega-lite spec
    protected mergeVegaLiteSpec(spec: any) {
        // XXX
        this._vegaLiteSpec = {
            ...spec,
            autosize: {
                type: 'fit',
                contains: 'padding',
                resize: true,
            },
            title: undefined,
            background: "transparent",
        };
    }

    protected componentInvalid(component: proto.analyzer.VizComponent, reason: string) {

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
                    this.componentInvalid(component, "viz component requires vega renderer");
                    return;
                }
                // XXX conflicts
                this._renderer = model.VizRendererType.BUILTIN_VEGA;
                break;
            }
            case proto.syntax.VizComponentType.NUMBER:
            case proto.syntax.VizComponentType.TABLE: {
                if (this._renderer != null && this._renderer != model.VizRendererType.BUILTIN_TABLE) {
                    this.componentInvalid(component, "viz component requires vega table");
                    return;
                }
                // XXX conflicts
                this._renderer = model.VizRendererType.BUILTIN_TABLE;
                break;
            }
        }

        // TODO This is literally doing nothing smart at the moment.
        //      Let there be fancy vega autogen logic.

        for (const c of this._table.columnNames || []) {
            this.requireColumn(c);
        }

        const rawSpec = component.componentSpec();
        if (rawSpec != null) {
            let spec = JSON.parse(rawSpec);
            this.mergeVegaLiteSpec(spec);
        }
    }

    // Build the query
    protected configureQuery(): model.VizDataSource {
        const colNames = this._table.columnNameMapping;
        const getColId = this.resolveColumnId.bind(this);
        return {
            targetShort: this._table.nameShort,
            targetQualified: this._table.nameQualified,
            columns: this._requiredColumns.map(c => colNames.get(c)!),
            orderBy: this._orderBy?.map(getColId) || [],
            partitionBy: this._partitionBy?.map(getColId) || [],
        };
    }

    // Build the vega spec (if any)
    protected configureVega(): v.Spec | null {
        if (this._vegaLiteSpec == null) return null;

        // just a hacky proof-of-concept for now
        let compiled = vl.compile(this._vegaLiteSpec).spec;
        return compiled;
    }

    public build(
        base: Pick<
            model.VizInfo,
            Exclude<
                keyof model.VizInfo,
                'timeCreated' | 'timeUpdated' | 'nameQualified' | 'nameShort' | 'renderer' | 'data' | 'vegaLiteSpec' | 'vegaSpec'
            >
        >,
    ): model.VizInfo {
        const now = new Date();
        const data = this.configureQuery();
        const vegaSpec = this._renderer == model.VizRendererType.BUILTIN_VEGA ? this.configureVega() : null;
        return {
            ...base,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this._table.nameQualified || '',
            nameShort: this._table.nameShort || '',
            renderer: this._renderer || model.VizRendererType.BUILTIN_TABLE,
            data,
            vegaLiteSpec: this._vegaLiteSpec,
            vegaSpec,
        };
    }
}
