import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as error from '../error';
import * as v from 'vega';
import * as vl from 'vega-lite';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import { ProgramInstance } from '../model';

import ActionStatusCode = proto.action.ActionStatusCode;

export abstract class VizActionLogic extends ProgramActionLogic {
    /// The program instance
    _programInstance: ProgramInstance | null = null;
    /// The viz spec
    _vizSpec: proto.analyzer.VizSpec | null = null;
    /// The table info (when fetched)
    _tableInfo: model.DatabaseTableInfo | null = null;

    /// The renderer type
    _renderer: model.VizRendererType | null = null;
    /// The required columns
    _requiredColumnIds: Map<string, number> = new Map();
    /// The required column list
    _requiredColumns: string[] = [];
    /// The vega-lite spec
    _vegaLiteSpec: vl.TopLevelSpec | null = null;

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

    /// Merge the user-provided data into a vega-lite spec
    protected mergeVegaLiteSpec(spec: any) {
        // XXX
        console.log(spec);
        this._vegaLiteSpec = {
            ...spec,
            autosize: "fit",
            resize: true,
            title: undefined
        };
    }

    /// Analayze a single viz component
    protected analyzeVizComponent(component: proto.analyzer.VizComponent) {
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
                // XXX conflicts
                this._renderer = model.VizRendererType.BUILTIN_VEGA;
                break;
            }
            case proto.syntax.VizComponentType.NUMBER:
            case proto.syntax.VizComponentType.TABLE:
                // XXX conflicts
                this._renderer = model.VizRendererType.BUILTIN_TABLE;
                break;
        }

        // TODO This is literally doing nothing smart at the moment.
        //      Let there be fancy vega autogen logic.

        for (const c of this._tableInfo?.columnNames || []) {
            this.requireColumn(c);
        }

        const rawSpec = component.componentSpec();
        if (rawSpec != null) {
            let spec = JSON.parse(rawSpec);
            console.log(spec);
            this.mergeVegaLiteSpec(spec);
        }
    }

    // Build the query
    protected buildQuery(): model.VizDataSource {
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

    // Build the vega spec (if any)
    protected buildVegaSpec(): v.Spec | null {
        if (this._vegaLiteSpec == null) 
            return null;

        // just a hacky proof-of-concept for now
        let compiled = vl.compile(this._vegaLiteSpec).spec;
        console.log(compiled);
        return compiled;
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
        for (let i = 0; i < this._vizSpec!.componentsLength(); ++i) {
            const c = this._vizSpec!.components(i)!;
            this.analyzeVizComponent(c)!;
        }

        const now = new Date();
        return {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.VIZ_INFO,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this.buffer.targetNameQualified() || '',
            nameShort: this.buffer.targetNameShort() || '',
            renderer: this._renderer || model.VizRendererType.BUILTIN_TABLE,
            currentStatementId: this.origin.statementId,
            title: this._vizSpec!.title() || null,
            position: pos,
            data: this.buildQuery(),
            vegaSpec: this._renderer == model.VizRendererType.BUILTIN_VEGA ? this.buildVegaSpec() : null,
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
