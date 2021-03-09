import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as error from '../error';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import { ProgramInstance, SVGStyleMap, VizComponentSpec, VizRendererType } from '../model';

import ActionStatusCode = proto.action.ActionStatusCode;
import VizComponentTypeModifier = proto.syntax.VizComponentTypeModifier;

/// Collect strings
function collectStr(fn: (i: number) => string, n: number) {
    let vec = [];
    for (let i = 0; i < n; ++i) vec.push(fn(i));
    return vec.length == 0 ? null : vec;
}

export abstract class VizActionLogic extends ProgramActionLogic {
    /// The program instance
    _programInstance: ProgramInstance | null = null;
    /// The viz spec
    _vizSpec: proto.viz.VizSpec | null = null;
    /// The table info (when fetched)
    _tableInfo: model.DatabaseTableInfo | null = null;

    /// The required columns
    _requiredColumnIds: Map<string, number> = new Map();
    /// The required column list
    _requiredColumns: string[] = [];
    /// The x attribute(s)
    _x: string[] | null = null;
    /// The y attribute(s)
    _y: string[] | null = null;
    /// The data clustering (if any)
    _clusterBy: string[] | null = null;
    /// The data stacking (if any)
    _stackBy: string[] | null = null;
    /// The data ordering (if any)
    _orderBy: string[] | null = null;
    /// The data partitioning (if any)
    _partitionBy: string[] | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    /// Get the qualified target name
    protected get tableNameQualified() {
        return this.buffer.targetNameQualified()!;
    }
    /// Has a column?
    protected hasColumn(column: string): boolean {
        return this._tableInfo!.columnNameMapping!.has(column);
    }

    /// Read context info
    public readContext(context: ActionContext) {
        /// Get the program instance
        this._programInstance = context.plan.programInstance;
        // Get viz spec
        this._vizSpec = context.plan.programInstance.vizSpecs.get(this.origin.statementId) || null;
        if (!this._vizSpec) {
            throw new error.VizLogicError('viz spec does not exist', this._programInstance);
        }
        // Get the table info
        const store = context.platform.store;
        this._tableInfo = store.getState().core.planDatabaseTables.get(this.tableNameQualified) || null;
        if (!this._tableInfo) {
            throw new error.VizLogicError('target table does not exist', this._programInstance);
        }
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

    /// Analayze a single viz component
    protected analyzeVizComponent(component: proto.viz.VizComponent): VizComponentSpec {
        // Collect type
        const type = component.type()!;
        let typeModifiers: Map<proto.syntax.VizComponentTypeModifier, boolean> = new Map();
        for (let i = 0; i < component.typeModifiersLength(); ++i) {
            typeModifiers.set(component.typeModifiers(i)!, true);
        }

        // Read the viz data
        const dataReader = component.data();
        let x = this._x || (this.hasColumn('x') ? ['x'] : null);
        let y = this._y || (this.hasColumn('y') ? ['y'] : null);
        let stackBy = this._stackBy;
        let clusterBy = this._clusterBy;
        let orderBy = this._orderBy;
        let partitionBy = this._partitionBy;

        /// We differentiate between the following situations:
        /// A) USING BAR (x = attr1, y = attr2)
        ///
        /// B) USING CLUSTERED BAR (x = [attr1, attr2], y = attr3)
        ///    User provides already pivotted x values.
        ///    No explicit ordering necessary.
        ///
        /// C) USING STACKED BAR (x = attr1, y = [attr2, attr3])
        ///    User provides already pivotted y values.
        ///    No explicit ordering necessary.
        ///
        /// D) USING CLUSTERED BAR (x = attr1, y = attr2, cluster = attr3)
        ///    We order by (attr3, x) ourselves.
        ///
        /// E) USING STACKED BAR (x = attr1, y = attr2, stack = attr3)
        ///    We order by (attr3, x) ourselves.
        ///
        /// + Combinations of above, e.g.:
        ///
        /// F) USING GROUPED STACKED BAR (x = attr1, y = [attr3, attr4], cluster = attr5)
        ///    User gives us pivotted stacks but we have to cluster x.
        ///    We order by (attr5, attr1) ourselves.

        if (dataReader) {
            x = collectStr(dataReader.x.bind(dataReader), dataReader.xLength()) || x;
            y = collectStr(dataReader.y.bind(dataReader), dataReader.yLength()) || y;
            clusterBy = collectStr(dataReader.cluster.bind(dataReader), dataReader.clusterLength()) || clusterBy;
            stackBy = collectStr(dataReader.stack.bind(dataReader), dataReader.stackLength()) || stackBy;
            orderBy = collectStr(dataReader.order.bind(dataReader), dataReader.orderLength()) || orderBy;
        }

        // XXX We may override a user-provided ordering here.
        //     Emit a warning or error if it differs.
        const isClustered = typeModifiers.has(VizComponentTypeModifier.CLUSTERED);
        const isStacked = typeModifiers.has(VizComponentTypeModifier.STACKED);
        if (isStacked) {
            if (isClustered) {
                orderBy = clusterBy?.concat(stackBy || []) || [];
                partitionBy = orderBy;
            } else {
                orderBy = stackBy?.concat(x || []) || [];
                partitionBy = stackBy;
            }
        } else if (isClustered) {
            orderBy = clusterBy?.concat(x || []) || [];
            partitionBy = orderBy;
        }
        x?.forEach((v) => this.requireColumn(v));
        y?.forEach((v) => this.requireColumn(v));
        clusterBy?.forEach((v) => this.requireColumn(v));
        stackBy?.forEach((v) => this.requireColumn(v));
        orderBy?.forEach((v) => this.requireColumn(v));

        // TODO Detect conflicts

        this._x = x;
        this._y = y;
        this._clusterBy = clusterBy;
        this._stackBy = stackBy;
        this._orderBy = orderBy;
        this._partitionBy = partitionBy;

        // Collect the style attributes
        const styles: SVGStyleMap = {};
        return {
            type,
            typeModifiers,
            styles,
            dataView: {
                x: x?.map(this.resolveColumnId.bind(this)) || [],
                y: y?.map(this.resolveColumnId.bind(this)) || []
            },
            selectionID: null,
        };
    }

    // Build the query
    protected buildQuery(): model.VizDataQuery {
        const colNames = this._tableInfo!.columnNameMapping;
        const getColId = this.resolveColumnId.bind(this);
        return {
            targetShort: this.buffer.targetNameShort()!,
            targetQualified: this.buffer.targetNameQualified()!,
            columns: this._requiredColumns.map((c) => colNames.get(c)!),
            orderBy: this._orderBy?.map(getColId) || [],
            clusterBy: this._clusterBy?.map(getColId) || [],
            stackBy: this._stackBy?.map(getColId) || [],
            partitionBy: this._partitionBy?.map(getColId) || [],
        }
    }

    /// Pick a viz renderer
    protected pickRenderer(components: VizComponentSpec[]): model.VizRendererType {
        let renderer = model.VizRendererType.BUILTIN_TABLE;
        for (const component of components) {
            switch (component.type) {
                case proto.syntax.VizComponentType.AREA:
                case proto.syntax.VizComponentType.AXIS:
                case proto.syntax.VizComponentType.BAR:
                case proto.syntax.VizComponentType.BOX_PLOT:
                case proto.syntax.VizComponentType.CANDLESTICK:
                case proto.syntax.VizComponentType.ERROR_BAR:
                case proto.syntax.VizComponentType.HISTOGRAM:
                case proto.syntax.VizComponentType.LINE:
                case proto.syntax.VizComponentType.PIE:
                case proto.syntax.VizComponentType.SCATTER:
                case proto.syntax.VizComponentType.VORONOI: {
                    renderer = model.VizRendererType.BUILTIN_VICTORY_SIMPLE;
                    let isGrouped =
                        component.typeModifiers.has(VizComponentTypeModifier.CLUSTERED) ||
                        component.typeModifiers.has(VizComponentTypeModifier.STACKED);
                    if (isGrouped) {
                        renderer = model.VizRendererType.BUILTIN_VICTORY_CLUSTERED;
                    }
                    break;
                }
                case proto.syntax.VizComponentType.TABLE:
                case proto.syntax.VizComponentType.NUMBER:
                case proto.syntax.VizComponentType.TABLE:
                    renderer = model.VizRendererType.BUILTIN_TABLE;
                    break;
            }
        }
        return renderer;
    }

    /// Derive viz renderer
    protected deriveVizInfo(context: ActionContext, mixin: Partial<model.VizInfo> = {}): model.VizInfo {
        // Read position
        const posReader = this._vizSpec!.position()!;
        const pos: model.VizPosition = {
            row: posReader.row(),
            column: posReader.column(),
            width: posReader.width(),
            height: posReader.height(),
        };

        // Read the component specs
        const components = new Array<model.VizComponentSpec>();
        for (let i = 0; i < this._vizSpec!.componentsLength(); ++i) {
            const c = this._vizSpec!.components(i)!;
            components.push(this.analyzeVizComponent(c)!);
        }

        const now = new Date();
        return {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.VIZ_INFO,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this.buffer.targetNameQualified() || '',
            nameShort: this.buffer.targetNameShort() || '',
            renderer: this.pickRenderer(components),
            currentStatementId: this.origin.statementId,
            title: this._vizSpec!.title() || undefined,
            position: pos,
            dataQuery: this.buildQuery(),
            components: components,
        };
    }
}

export class CreateVizActionLogic extends VizActionLogic {
    /// The promise to get the row count
    _rowCountPromise: Promise<webdb.Value[]> | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepareExecution(context: ActionContext) {
        this.readContext(context);
        this._rowCountPromise = context.platform.database.requestTableStatistics(
            this.tableNameQualified,
            model.TableStatisticsType.COUNT_STAR,
        );
    }

    public async execute(context: ActionContext): Promise<model.ActionHandle> {
        // Make sure the row count is available in the vizzes
        await context.platform.database.evaluateTableStatistics(this.tableNameQualified);
        await this._rowCountPromise!;

        // Store the viz info
        const info = this.deriveVizInfo(context);
        model.mutate(context.platform.store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [info],
        });
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}

export class DropVizActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepareExecution(_context: ActionContext) {}

    public async execute(context: ActionContext): Promise<model.ActionHandle> {
        const store = context.platform.store!;
        const objectId = this.buffer.objectId();
        model.mutate(store.dispatch, {
            type: model.StateMutationType.DELETE_PLAN_OBJECTS,
            data: [objectId],
        });
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}

export class ImportVizActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepareExecution(_context: ActionContext) {}

    public async execute(_context: ActionContext): Promise<model.ActionHandle> {
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}
