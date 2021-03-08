import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import * as model from '../model';
import * as error from '../error';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import ActionStatusCode = proto.action.ActionStatusCode;
import { ProgramInstance, SVGStyleMap, VizComponentSpec } from '../model';

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

    /// The x attribute(s)
    _dataX: string[] | null = null;
    /// The y attribute(s)
    _dataY: string[] | null = null;
    /// The groupBy attributes (if any)
    _dataGroupBy: string[] | null = null;
    /// The stackBy attributes (if any)
    _dataStackBy: string[] | null = null;
    /// The orderBy attributes (if any)
    _dataOrderBy: string[] | null = null;
    /// The samples
    _dataSamples: number | null = null;

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
        let data: model.VizData = {
            x: this._dataX || (this.hasColumn('x') ? ['x'] : null),
            y: this._dataY || (this.hasColumn('y') ? ['y'] : null),
            groupBy: this._dataGroupBy,
            stackBy: this._dataStackBy,
            orderBy: this._dataOrderBy,
            samples: this._dataSamples || DEFAULT_SAMPLE_SIZE,
        };
        if (dataReader) {
            /// Detect the grouping mode for x and y axis.
            /// Note that the grouping of the y-axis is also referred to as "stacking".
            ///
            /// We differentiate between the following situations:
            /// A) USING BAR (x = attr1, y = attr2)
            ///
            /// B) USING GROUPED BAR (x = [attr1, attr2], y = attr3)
            ///    User provides already pivotted x values.
            ///
            /// C) USING STACKED BAR (x = attr1, y = [attr2, attr3])
            ///    User provides already privotted y values.
            ///
            /// D) USING GROUPED BAR (x = attr1, y = attr2, group_by = attr3)
            ///    We need to group x ourselves.
            ///
            /// E) USING STACKED BAR (x = attr1, y = attr2, stack_by = [attr3, attr4])
            ///    We need to group y ourselves.
            ///
            /// + Combinations of above, e.g.:
            ///
            /// F) USING GROUPED STACKED BAR (x = [attr1, attr2], y = attr3, stack_by = [attr4, attr5])
            ///    User gives us pivotted x groups but we have to group y.
            ///    (e.g. SELECT attr3, attr4, max(attr1), max(attr2), max(attr3) GROUP BY attr3, attr4 ORDER BY attr1, attr2, attr3, attr4, attr5)

            let x: string[] | null = collectStr(dataReader.x, dataReader.xLength());
            let y: string[] | null = collectStr(dataReader.y, dataReader.yLength());
            let groupBy: string[] | null = collectStr(dataReader.groupBy, dataReader.groupByLength());
            let stackBy: string[] | null = collectStr(dataReader.stackBy, dataReader.stackByLength());
            let isGrouping: boolean = false;
            let isStacking: boolean = false;

            // Is grouped?
            // The user either gave us multiple x-attributes or specified `group`.
            if (typeModifiers.has(VizComponentTypeModifier.GROUPED)) {
                if (x && x.length > 1 && groupBy && groupBy.length > 0) {
                    // XXX Cannot specify both, pivot groups and group by
                    throw new error.VizLogicError(
                        'cannot specify both, pivot groups and group by',
                        this._programInstance!,
                    );
                }
            }

            // Is stacked?
            // The user either gave us multiple y-attributes or specified `stack`.
            if (typeModifiers.has(VizComponentTypeModifier.STACKED)) {
                if (y && y.length > 1 && stackBy && stackBy.length > 0) {
                    // XXX Cannot specify both, pivot groups and group by
                    throw new error.VizLogicError(
                        'cannot specify both, pivot groups and group by',
                        this._programInstance!,
                    );
                }
            }

            let orderBy = collectStr(dataReader.orderBy, dataReader.orderByLength());
            if (isGrouping || isStacking) {
                // XXX We override the user ordering here.
                //     Emit a warning or error if it differs.
                orderBy = !y ? x : x?.concat(y) || null;
            }

            data = {
                x: x || data.x,
                y: y || data.y,
                groupBy: groupBy || data.groupBy,
                stackBy: stackBy || data.stackBy,
                orderBy: orderBy || data.orderBy,
                samples: dataReader.samples() || data.samples,
            };

            /// XXX Detect when data spec conflicts with other components
        }

        // Collect the style attributes
        const styles: SVGStyleMap = {};
        return {
            type,
            typeModifiers,
            styles,
            data,
            selectionID: null,
        };
    }

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
