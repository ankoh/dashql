import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as error from '../error';
import { VizComposer } from '../viz/viz_composer';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export abstract class VizActionLogic extends ProgramActionLogic {
    /// The viz spec
    _vizSpec: proto.analyzer.VizSpec | null = null;
    /// The viz composer
    _vizComposer: VizComposer | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    /// Get the qualified table name
    protected get tableNameQualified() {
        return this.buffer.targetNameQualified()!;
    }

    /// Read context info
    public configureVizComposer(context: ActionContext) {
        // Get the table info
        const programInstance = context.plan.programInstance;
        const store = context.platform.store;
        const tableInfo = store.getState().core.planDatabaseTables.get(this.tableNameQualified) || null;
        if (!tableInfo) {
            throw new error.VizLogicError(`target table ${this.tableNameQualified} does not exist`, programInstance);
        }
        // Build the composer
        const stats = context.platform._databaseManager.resolveTableStatistics(tableInfo.tableNameQualified)!;
        this._vizComposer = new VizComposer(stats);

        // Read the component specs and add them to the compose
        for (let i = 0; i < this._vizSpec.componentsLength(); ++i) {
            const c = this._vizSpec.components(i)!;
            const type = c.type()!;
            let mods: Map<proto.syntax.VizComponentTypeModifier, boolean> = new Map();
            for (let i = 0; i < c.typeModifiersLength(); ++i) {
                mods.set(c.typeModifiers(i)!, true);
            }
            const optionsJSON = c.options() || '';
            const options = JSON.parse(optionsJSON);
            this._vizComposer.addComponent(type, mods, options)!;
        }

        // Combine all the components
        this._vizComposer.combineComponents();
    }
}

export class CreateVizActionLogic extends VizActionLogic {
    /// The promise to get the row count
    _rowCountPromise: Promise<webdb.Value[]> | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepare(context: ActionContext, planObjects: model.PlanObject[]): void {
        // Get the program instance
        const programInstance = context.plan.programInstance;
        // Get viz spec
        this._vizSpec = programInstance.vizSpecs.get(this.origin.statementId) || null;
        if (!this._vizSpec) {
            throw new error.VizLogicError('viz spec does not exist', programInstance);
        }
        // Get position
        const posReader = this._vizSpec!.position()!;
        const pos: model.VizPosition = {
            row: posReader.row(),
            column: posReader.column(),
            width: posReader.width(),
            height: posReader.height(),
        };
        const now = new Date();
        const info: model.VizInfo = {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.VIZ_INFO,
            timeCreated: now,
            timeUpdated: now,
            currentStatementId: this.origin.statementId,
            position: pos,
            title: this._vizSpec!.title() || null,
            renderer: null,
            vegaLiteSpec: null,
            vegaSpec: null,
            dataSource: null,
        };
        planObjects.push(info);
    }

    public willExecute(context: ActionContext) {
        this.configureVizComposer(context);
        this._rowCountPromise = context.platform.database.requestTableStatistics(
            this.tableNameQualified,
            model.TableStatisticsType.COUNT_STAR,
        );
    }

    public async execute(context: ActionContext): Promise<void> {
        // Make sure the row count is available in the vizzes
        await context.platform.database.evaluateTableStatistics(this.tableNameQualified);
        await this._rowCountPromise!;

        // Get viz info
        const oid = this.buffer.objectId().toString();
        const state = context.platform.store.getState();
        let viz = state.core.planObjects.get(oid) as model.VizInfo;
        console.assert(viz !== undefined, 'missing initial viz object');

        // Create new viz object
        const now = new Date();
        const spec = await this._vizComposer!.compile();
        viz = {
            ...viz,
            ...spec,
            timeUpdated: now,
        };
        model.mutate(context.platform.store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [viz],
        });
    }
}

export class DropVizActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepare(_context: ActionContext) {}
    public willExecute(_context: ActionContext) {}
    public async execute(context: ActionContext): Promise<void> {
        const store = context.platform.store!;
        const objectId = this.buffer.objectId();
        model.mutate(store.dispatch, {
            type: model.StateMutationType.DELETE_PLAN_OBJECTS,
            data: [objectId],
        });
    }
}

export class ImportVizActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepare(_context: ActionContext) {}
    public willExecute(_context: ActionContext) {}
    public async execute(_context: ActionContext): Promise<void> {}
}
