import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as error from '../error';
import * as Immutable from 'immutable';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import ActionStatusCode = proto.action.ActionStatusCode;
import { SVGStyleMap } from '../model';

export abstract class BaseVizActionLogic extends ProgramActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    protected get tableNameQualified() {
        return this.buffer.targetNameQualified()!;
    }

    protected getDefaultVizInfo(): model.VizInfo {
        const now = new Date();
        return {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.VIZ_INFO,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this.buffer.targetNameQualified() || '',
            nameShort: this.buffer.targetNameShort() || '',

            currentStatementId: this.origin.statementId,
            position: {
                row: 0,
                column: 0,
                width: 0,
                height: 0,
            },
            components: [],
        };
    }

    protected deriveVizInfo(context: ActionContext, mixin: Partial<model.VizInfo> = {}): model.VizInfo {
        const instance = context.plan.programInstance;
        const store = context.platform.store;

        // Get viz spec
        const vizSpec = instance.vizSpecs.get(this.origin.statementId);
        if (!vizSpec) {
            return this.getDefaultVizInfo();
        }

        // Get the table info
        const tableInfo = store.getState().core.planDatabaseTables.get(this.tableNameQualified);
        if (!tableInfo) {
            return this.getDefaultVizInfo();
        }
        const cols = tableInfo.columnNameMapping;
        const getCol = (n: string): string[] | undefined => (
            cols.has(n) ? [n] : undefined
        );

        // Read position
        const posReader = vizSpec.position()!;
        const pos: model.VizPosition = {
            row: posReader.row(),
            column: posReader.column(),
            width: posReader.width(),
            height: posReader.height(),
        };

        // The common data attributes in case some are not set
        let sharedX: string[] | undefined = undefined;
        let sharedY: string[] | undefined = undefined;
        let sharedGroup: string[] | undefined = undefined;
        let sharedStack: string[] | undefined = undefined;
        let sharedOrder: string[] | undefined = undefined;
        let sharedSamples: number | undefined = undefined;

        const collectStr = (fn: (i: number) => string, n: number) =>{
            let vec = [];
            for (let i = 0; i < n; ++i)
                vec.push(fn(i));
            return vec.length > 0 ? vec : undefined;
        };

        // Read the component specs
        const components = new Array<model.VizComponentSpec>();
        for (let i = 0; i < vizSpec.componentsLength(); ++i) {
            const c = vizSpec.components(i)!;

            // Collect type
            const type = c.type()!;
            let typeModifiers: Map<proto.syntax.VizComponentTypeModifier, boolean> = new Map();
            for (let i = 0; i < c.typeModifiersLength(); ++i) {
                typeModifiers.set(c.typeModifiers(i)!, true);
            }

            // Read the viz data
            const dataReader = c.data();
            let data: model.VizData = {
                x: sharedX || getCol('x'),
                y: sharedY || getCol('y'),
                group: sharedGroup,
                stack: sharedStack,
                order: sharedOrder,
                samples: sharedSamples,
            };
            // Specified data attributes always override previous attributes
            if (dataReader) {
                data = {
                    x: collectStr(dataReader.x, dataReader.xLength()) || data.x,
                    y: collectStr(dataReader.y, dataReader.yLength()) || data.y,
                    group: collectStr(dataReader.group, dataReader.groupLength()) || data.group,
                    stack: collectStr(dataReader.stack, dataReader.stackLength()) || data.stack,
                    order: collectStr(dataReader.order, dataReader.orderLength()) || data.order,
                    samples: dataReader.samples() || data.samples,
                };
            }
            sharedX = data.x || sharedX;
            sharedY = data.y || sharedY;
            sharedStack = data.stack || sharedStack;
            sharedGroup = data.group || sharedGroup;
            sharedOrder = data.order || sharedOrder;
            sharedSamples = data.samples || sharedSamples;

            // Collect the style attributes
            const styles: SVGStyleMap = {};

            // Build the components
            components.push({
                type,
                typeModifiers,
                styles,
                data,
                selectionID: null,
            });
        }

        const now = new Date();
        return {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.VIZ_INFO,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this.buffer.targetNameQualified() || '',
            nameShort: this.buffer.targetNameShort() || '',
            currentStatementId: this.origin.statementId,
            title: vizSpec.title() || undefined,
            position: pos,
            components: components,
        };
    }
}

export class CreateVizActionLogic extends BaseVizActionLogic {
    /// The promise to get the row count
    _rowCountPromise: Promise<webdb.Value[]> | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepareExecution(context: ActionContext) {
        // We will need the row count in any case
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
        const store = context.platform.store;
        const info = this.deriveVizInfo(context);
        model.mutate(store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [info],
        });
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}

export class UpdateVizActionLogic extends BaseVizActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepareExecution(_context: ActionContext) {}

    public async execute(context: ActionContext): Promise<model.ActionHandle> {
        const state = context.platform.store.getState();
        const prev = state.core.planObjects.get(this.buffer.objectId().toString()) as model.VizInfo;

        const info = this.deriveVizInfo(context);
        const store = context.platform.store;
        model.mutate(store.dispatch, {
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
