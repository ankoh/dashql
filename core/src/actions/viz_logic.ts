import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as error from '../error';
import * as Immutable from 'immutable';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import ActionStatusCode = proto.action.ActionStatusCode;
import { Action, SVGStyleMap, VizDataGrouping } from '../model';

import VizComponentTypeModifier = proto.syntax.VizComponentTypeModifier;

export abstract class VizActionLogic extends ProgramActionLogic {
    /// The viz spec 
    _vizSpec: proto.viz.VizSpec | null = null;
    /// The table info (when fetched)
    _tableInfo: model.DatabaseTableInfo | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    protected get tableNameQualified() {
        return this.buffer.targetNameQualified()!;
    }

    protected readContext(context: ActionContext): boolean {
        // Get viz spec
        this._vizSpec = context.plan.programInstance.vizSpecs.get(this.origin.statementId) || null;
        if (!this._vizSpec) {
            // XXX could not find viz spec
            return false;
        }

        const store = context.platform.store;
        this._tableInfo = store.getState().core.planDatabaseTables.get(this.tableNameQualified) || null;
        if (!this._tableInfo) {
            // XXX target table does not exist
            return false;
        }
        return true;
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

        const cols = this._tableInfo!.columnNameMapping;
        const getCol = (n: string): string[] | undefined => (
            cols.has(n) ? [n] : undefined
        );

        // Read position
        const posReader = this._vizSpec!.position()!;
        const pos: model.VizPosition = {
            row: posReader.row(),
            column: posReader.column(),
            width: posReader.width(),
            height: posReader.height(),
        };

        // The common data attributes in case some are not set
        let sharedX: string[] | undefined = undefined;
        let sharedY: string[] | undefined = undefined;
        let sharedXGrouping: model.VizDataGrouping | undefined = undefined;
        let sharedYGrouping: model.VizDataGrouping | undefined = undefined;
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
        for (let i = 0; i < this._vizSpec!.componentsLength(); ++i) {
            const c = this._vizSpec!.components(i)!;

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
                xGrouping: VizDataGrouping.NO_GROUPING,
                yGrouping: VizDataGrouping.NO_GROUPING,
                order: sharedOrder,
                samples: sharedSamples,
            };
            // Specified data attributes always override previous attributes
            if (dataReader) {
                /// Detect the grouping mode for x and y axis.
                /// Note that the grouping of the y-axis is also referred to as "stacking".
                ///
                /// We differentiate between the following situations:
                /// A) USING BAR (x = attr1, y = attr2)
                ///    Displays (attr1 -> attr3) bars, easy, very fast, allows for sampling.
                ///
                /// B) USING GROUPED BAR (x = [attr1, attr2], y = attr3)
                ///    User provides already pivotted x values.
                ///    Displays ((attr1, attr2) -> attr3) bars, no preprocessing, very fast, allows for sampling.
                ///
                /// C) USING STACKED BAR (x = attr1, y = [attr2, attr3])
                ///    User provides already privotted y values.
                ///    Displays ((attr1) -> (attr2, attr3)) bars, no preprocessing, very fast, allows for sampling.
                ///         
                /// D) USING GROUPED BAR (y = attr1, group = attr2)
                ///    We need to group x ourselves.
                ///    Displays (groups(attr2) -> attr1) bars, slower because of grouping.
                ///
                /// E) USING STACKED BAR (x = attr1, stack = [attr2, attr3])
                ///    We need to group y ourselves.
                ///    Displays ((attr1) -> groups(attr2, attr3)) bars, slower because of grouping.
                ///
                /// + Combinations of above, e.g.:
                ///
                /// F) USING GROUPED STACKED BAR (x = [attr1, attr2], stack = [attr3, attr4])
                ///    User gives us pivotted x groups but we have to group y.
                ///    (e.g. SELECT attr3, attr4, max(attr1), max(attr2) GROUP BY attr3, attr4 ORDER BY attr1, attr2, attr3, attr4)
                ///    Displays (attr1, attr2) -> groups(attr3, attr4) bars, slower because of grouping.
                ///
                /// G) USING GROUPED STACKED BAR (group = [attr1, attr2], stack = [attr3, attr4])
                ///    We have to group x and y.
                ///    Displays groups(attr3, attr4) -> groups(attr1, attr2)

                let x: string[] = [];
                let y: string[] = [];
                let xGrouping: model.VizDataGrouping = model.VizDataGrouping.NO_GROUPING;
                let yGrouping: model.VizDataGrouping = model.VizDataGrouping.NO_GROUPING;
                let withExplicitGrouping: boolean = false;

                // Is grouped?
                // The user either gave us multiple x-attributes or specified `group`.
                if (typeModifiers.has(VizComponentTypeModifier.GROUPED)) {
                    let key: string[];
                    if (dataReader.groupByLength() > 0) {
                        x = collectStr(dataReader.groupBy, dataReader.groupByLength())!;
                        xGrouping = model.VizDataGrouping.GROUP_BY;
                        withExplicitGrouping = true;
                    } else {
                        x = collectStr(dataReader.x, dataReader.xLength()) || data.x || [];
                        xGrouping = model.VizDataGrouping.GROUP_PIVOT;
                    }
                }

                // Is stacked?
                // The user either gave us multiple y-attributes or specified `stack`.
                if (typeModifiers.has(VizComponentTypeModifier.STACKED)) {
                    if (dataReader.groupByLength() > 0) {
                        y = collectStr(dataReader.stackBy, dataReader.stackByLength())!;
                        yGrouping = model.VizDataGrouping.GROUP_BY;
                        withExplicitGrouping = true;
                    } else {
                        y = collectStr(dataReader.y, dataReader.xLength()) || data.y|| [];
                        yGrouping = model.VizDataGrouping.GROUP_PIVOT;
                    }
                }

                let ordering = collectStr(dataReader.orderBy, dataReader.orderByLength()) || data.order;
                if (withExplicitGrouping) {
                    // XXX We override the user ordering here.
                    //     Emit a warning or error if it differs.
                    ordering = x.concat(y);
                }

                data = {
                    x, y, xGrouping, yGrouping,
                    order: ordering,
                    samples: withExplicitGrouping ? undefined : (dataReader.samples() || data.samples),
                };

                /// XXX Detect when data spec conflicts with other components
            }
            sharedX = data.x || sharedX;
            sharedY = data.y || sharedY;
            sharedXGrouping = data.xGrouping || sharedXGrouping;
            sharedYGrouping = data.yGrouping || sharedYGrouping;
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
            title: this._vizSpec!.title() || undefined,
            position: pos,
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
        // We will need the row count in any case
        this._rowCountPromise = context.platform.database.requestTableStatistics(
            this.tableNameQualified,
            model.TableStatisticsType.COUNT_STAR,
        );
    }

    public async execute(context: ActionContext): Promise<model.ActionHandle> {
        // Setup viz logic
        if (!this.readContext(context)) {
            return this.returnWithStatus(ActionStatusCode.FAILED);
        }
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

export class UpdateVizActionLogic extends VizActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepareExecution(_context: ActionContext) {}

    public async execute(context: ActionContext): Promise<model.ActionHandle> {
        if (!this.readContext(context)) {
            return this.returnWithStatus(ActionStatusCode.FAILED);
        }
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
