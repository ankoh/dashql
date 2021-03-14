import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as error from '../error';
import { VizComposer } from './viz_composer';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';

import ActionStatusCode = proto.action.ActionStatusCode;

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
        // Get the program instance
        const programInstance = context.plan.programInstance;
        // Get viz spec
        this._vizSpec = programInstance.vizSpecs.get(this.origin.statementId) || null;
        if (!this._vizSpec) {
            throw new error.VizLogicError('viz spec does not exist', programInstance);
        }
        // Get the table info
        const store = context.platform.store;
        let tableInfo = store.getState().core.planDatabaseTables.get(this.tableNameQualified) || null;
        if (!tableInfo) {
            throw new error.VizLogicError('target table does not exist', programInstance);
        }
        // Build the composer
        this._vizComposer = new VizComposer(context.platform, context.plan, tableInfo);

        // Read the component specs and add them to the compose
        for (let i = 0; i < this._vizSpec.componentsLength(); ++i) {
            const c = this._vizSpec.components(i)!;
            this._vizComposer.addComponent(c)!;
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

    public prepareExecution(context: ActionContext) {
        this.configureVizComposer(context);
        this._rowCountPromise = context.platform.database.requestTableStatistics(
            this.tableNameQualified,
            model.TableStatisticsType.COUNT_STAR,
        );
    }

    public async execute(context: ActionContext): Promise<model.ActionHandle> {
        // Make sure the row count is available in the vizzes
        await context.platform.database.evaluateTableStatistics(this.tableNameQualified);
        await this._rowCountPromise!;

        // Build the viz info and store it in redux
        const posReader = this._vizSpec!.position()!;
        const pos: model.VizPosition = {
            row: posReader.row(),
            column: posReader.column(),
            width: posReader.width(),
            height: posReader.height(),
        };
        const info = await this._vizComposer!.buildViz({
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.VIZ_INFO,
            title: this._vizSpec!.title() || null,
            position: pos,
            currentStatementId: this.origin.statementId,
        });
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
