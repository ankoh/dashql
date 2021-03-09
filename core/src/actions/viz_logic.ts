import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as error from '../error';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import { ProgramInstance, SVGStyleMap, VizComponentSpec, VizRendererType } from '../model';

import ActionStatusCode = proto.action.ActionStatusCode;
import VizComponentTypeModifier = proto.syntax.VizComponentTypeModifier;

const DEFAULT_SAMPLE_SIZE = 1024;

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

    /// The requested columns
    _requiredColumns: Map<string, boolean> = new Map();
    /// The key columns
    _keyColumns: Map<string, boolean> = new Map();
    /// The x attribute(s)
    _dataX: string[] | null = null;
    /// The y attribute(s)
    _dataY: string[] | null = null;
    /// Group the x attribute?
    _groupX = false;
    /// Group the x attribute?
    _groupY = false;
    /// The orderBy attributes (if any)
    _dataOrder: string[] | null = null;

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
        let dataX = this._dataX || (this.hasColumn('x') ? ['x'] : null);
        let dataY = this._dataY || (this.hasColumn('y') ? ['y'] : null);
        let dataOrder = this._dataOrder;
        let pivotX = false;
        let pivotY = false;

        /// Detect the grouping mode for x and y axis.
        /// Note that the grouping of the y-axis is also referred to as "stacking".
        ///
        /// We differentiate between the following situations:
        /// A) USING BAR (x = attr1, y = attr2)
        ///
        /// B) USING GROUPED BAR (x = [attr1, attr2], y = attr3, pivot_x = true)
        ///    User provides already pivotted x values.
        ///
        /// C) USING STACKED BAR (x = attr1, y = [attr2, attr3], pivot_y = true)
        ///    User provides already privotted y values.
        ///
        /// D) USING GROUPED BAR (x = attr2, y = attr1)
        ///    We need to group x ourselves.
        ///
        /// E) USING STACKED BAR (x = attr1, y = [attr2, attr3])
        ///    We need to group y ourselves.
        ///
        /// + Combinations of above, e.g.:
        ///
        /// F) USING GROUPED STACKED BAR (x = [attr1, attr2], y = [attr3, attr4], pivot_x = true)
        ///    User gives us pivotted x groups but we have to group y.
        ///    (e.g. SELECT attr3, attr4, max(attr1), max(attr2) GROUP BY attr3, attr4 ORDER BY attr1, attr2, attr3, attr4)

        if (dataReader) {
            dataX = collectStr(dataReader.x.bind(dataReader), dataReader.xLength()) || dataX;
            dataY = collectStr(dataReader.y.bind(dataReader), dataReader.yLength()) || dataY;
            dataOrder = collectStr(dataReader.order.bind(dataReader), dataReader.orderLength()) || dataOrder;
            pivotX = dataReader.pivotX();
            pivotY = dataReader.pivotY();
        }

        // Force ordering?
        const isGrouping = typeModifiers.has(VizComponentTypeModifier.GROUPED);
        const isStacking = typeModifiers.has(VizComponentTypeModifier.STACKED);
        if (isGrouping || isStacking) {
            // XXX We override the user ordering here.
            //     Emit a warning or error if it differs.
            dataOrder = dataX?.concat(dataY || []) || null;
        }
        if (isGrouping && !pivotX) dataX?.forEach((x) => this._keyColumns.set(x, true));
        if (isStacking && !pivotY) dataY?.forEach((y) => this._keyColumns.set(y, true));

        // Register required columns
        dataX?.forEach((x) => this._requiredColumns.set(x, true));
        dataY?.forEach((y) => this._requiredColumns.set(y, true));
        dataOrder?.forEach((o) => this._requiredColumns.set(o, true));

        /// XXX Detect when data spec conflicts with other components

        this._dataX = dataX;
        this._dataY = dataY;
        this._dataOrder = dataOrder;

        // Collect the style attributes
        const styles: SVGStyleMap = {};
        return {
            type,
            typeModifiers,
            styles,
            data: {
                x: dataX,
                y: dataY,
                groupX: isGrouping && !pivotX,
                groupY: isStacking && !pivotY,
                order: dataOrder
            },
            selectionID: null,
        };
    }

    /// Build the query
    protected buildQuery(): model.VizQuery | null {
        // No query necessary?
        // We will just run a SELECT * with sampling.
        if (this._keyColumns.size == 0) return null;

        // Collect aggregates
        let additional = new Map<string, boolean>();
        for (const [c, _b] of this._requiredColumns) {
            if (!this._keyColumns.has(c)) additional.set(c, true);
        }

        // Build keys
        let colMap = new Map();
        let keyList = '';
        let keyColumns = [];
        let i = 0;
        for (const [k, _v] of this._keyColumns) {
            colMap.set(k, i);
            keyColumns.push(i);
            if (i++ > 0) keyList += ', ';
            keyList += k;
        }

        // Build attributes
        let query = `SELECT ${keyList}`;
        for (const [k, _v] of additional) {
            colMap.set(k, i);
            if (i++ > 0) query += ', ';
            query += `max(${k}) AS ${k}`;
        }
        let order = this._dataOrder?.join(",");
        query += ` FROM ${this._tableInfo?.nameShort!} GROUP BY ${keyList} ORDER BY ${order}`;

        return {
            script: query,
            columnMapping: colMap,
            keyColumns: keyColumns
        };
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
                        component.typeModifiers.has(VizComponentTypeModifier.GROUPED) ||
                        component.typeModifiers.has(VizComponentTypeModifier.STACKED);
                    if (isGrouped) {
                        renderer = model.VizRendererType.BUILTIN_VICTORY_GROUPED;
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
            query: this.buildQuery(),
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
