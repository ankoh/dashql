// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import * as model from '../model';
import * as error from '../error';
import * as arrow from 'apache-arrow';
import { ADD_CARD, CardDataResolver, DELETE_CARD, UPDATE_CARD } from '../model';
import { VegaComposer } from '../viz/vega_composer';
import { ProgramTaskLogic, SetupTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';
import { TableStatisticsType } from '../model';

export abstract class VizTaskLogic extends ProgramTaskLogic {
    /// The viz spec
    _card: proto.analyzer.Card | null = null;
    /// The renderer
    _renderer: model.CardRendererType | null = null;
    /// The viz composer
    _vega: VegaComposer | null = null;
    /// The table (if needed)
    _table: model.TableMetadata | null = null;
    /// The promise to get the row count (if needed)
    _rowCount: Promise<arrow.Column> | null = null;

    constructor(task_id: model.TaskHandle, task: proto.task.ProgramTask, statement: model.Statement) {
        super(task_id, task, statement);
    }

    /// Configure the visualization
    public configure(ctx: TaskExecutionContext): void {
        // Select the renderer
        const instance = ctx.planContext.plan!.programInstance;
        const target = this._card!.vizTarget()!;
        this.selectRenderer(ctx, instance);

        // Helper to check if a name refers to a table
        const requireTable = (name: string) => {
            const table = ctx.database.metadata.tables.get(name);
            if (table) return table;
            throw new error.TaskLogicError(`renderer requires ${name} to be a SQL Table or SQL View`, instance);
        };

        // Prepare the renderers
        switch (this._renderer) {
            case model.CardRendererType.BUILTIN_VEGA: {
                // Make sure a table with that name exists
                this._table = requireTable(target);
                // Configure the vega composer
                this.configureVegaComposer(ctx, this._table);
                break;
            }
            case model.CardRendererType.BUILTIN_TABLE: {
                // Make sure a table with that name exists
                this._table = requireTable(target);
                // Request the row count
                this._rowCount = ctx.database.requestTableStatistics(target, model.TableStatisticsType.COUNT_STAR);
                // Request table statistics
                for (let i = 0; i < this._table.columnTypes.length; ++i) {
                    const type = this._table.columnTypes[i];
                    switch (type.typeId) {
                        case arrow.Type.Int:
                        case arrow.Type.Int16:
                        case arrow.Type.Int32:
                        case arrow.Type.Int64:
                        case arrow.Type.Float:
                        case arrow.Type.Float16:
                        case arrow.Type.Float32:
                        case arrow.Type.Float64:
                        case arrow.Type.Uint8:
                        case arrow.Type.Uint16:
                        case arrow.Type.Uint32:
                        case arrow.Type.Uint64:
                            ctx.database.requestTableStatistics(target, TableStatisticsType.MAXIMUM_VALUE, i);
                            ctx.database.requestTableStatistics(target, TableStatisticsType.MINIMUM_VALUE, i);
                            break;
                    }
                }
                break;
            }
            case model.CardRendererType.BUILTIN_JSON:
            case model.CardRendererType.BUILTIN_HEX:
                // XXX Make sure a blob with that name exists
                break;
        }
    }

    /// Select the renderer
    public selectRenderer(context: TaskExecutionContext, programInstance: model.ProgramInstance): void {
        if (this._card == null) return;
        let renderer: model.CardRendererType | null = null;
        const tmp = new proto.analyzer.VizComponent();
        for (let i = 0; i < this._card.vizComponentsLength(); ++i) {
            const c = this._card.vizComponents(i, tmp)!;
            let require: model.CardRendererType;
            switch (c.type()) {
                case proto.syntax.VizComponentType.AREA:
                case proto.syntax.VizComponentType.AXIS:
                case proto.syntax.VizComponentType.BAR:
                case proto.syntax.VizComponentType.BOX:
                case proto.syntax.VizComponentType.CANDLESTICK:
                case proto.syntax.VizComponentType.ERROR_BAR:
                case proto.syntax.VizComponentType.LINE:
                case proto.syntax.VizComponentType.PIE:
                case proto.syntax.VizComponentType.SCATTER:
                case proto.syntax.VizComponentType.SPEC:
                    require = model.CardRendererType.BUILTIN_VEGA;
                    break;
                case proto.syntax.VizComponentType.JSON:
                    require = model.CardRendererType.BUILTIN_JSON;
                    break;
                case proto.syntax.VizComponentType.HEX:
                    require = model.CardRendererType.BUILTIN_HEX;
                    break;
                case proto.syntax.VizComponentType.TABLE:
                    require = model.CardRendererType.BUILTIN_TABLE;
                    break;
            }
            if (renderer != null && renderer != require) {
                throw new error.TaskLogicError(
                    `incompatible viz renderers: assumed ${require}, no require ${require}`,
                    programInstance,
                );
            }
            renderer = require;
        }
        this._renderer = renderer;
    }

    /// Read context info
    public configureVegaComposer(ctx: TaskExecutionContext, table: model.TableMetadata): void {
        // Build the composer
        if (this._card == null) return;
        const stats = ctx.database.resolveTableStatistics(table.nameQualified)!;
        this._vega = new VegaComposer(stats);

        // Read the component specs and add them to the composer
        for (let i = 0; i < this._card.vizComponentsLength(); ++i) {
            const c = this._card.vizComponents(i)!;
            const type = c.type()!;
            const mods: Map<proto.syntax.VizComponentTypeModifier, boolean> = new Map();
            for (let j = 0; j < c.typeModifiersLength(); ++i) {
                mods.set(c.typeModifiers(j)!, true);
            }
            const optionsJSON = c.extra() || '';
            const options = JSON.parse(optionsJSON);
            this._vega.addComponent(type, mods, options)!;
        }

        // Combine all the components
        this._vega.combineComponents();
    }
}

export class CreateVizTaskLogic extends VizTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.ProgramTask, statement: model.Statement) {
        super(task_id, task, statement);
    }

    /// Prepare the viz creation
    public prepare(ctx: TaskExecutionContext): void {
        // Get the program instance
        const instance = ctx.planContext.plan?.programInstance;
        if (!instance) return;
        // Get viz spec
        this._card = instance.cards.get(this.origin.statementId) || null;
        if (!this._card) {
            throw new error.TaskLogicError('card proto does not exist', instance);
        }
        // Get position
        const posReader = this._card!.cardPosition()!;
        const pos: model.CardPosition = {
            row: posReader.row(),
            column: posReader.column(),
            width: posReader.width(),
            height: posReader.height(),
        };
        const now = new Date();
        ctx.planContextDiff.push({
            type: ADD_CARD,
            data: {
                objectId: this.buffer.objectId(),
                timeCreated: now,
                timeUpdated: now,
                nameQualified: this.buffer.nameQualified() || '',
                cardType: proto.analyzer.CardType.BUILTIN_VIZ,
                cardRenderer: this._renderer,
                statementID: this.origin.statementId,
                position: pos,
                title: this._card!.cardTitle() || null,
                inputExtra: null,
                vegaLiteSpec: null,
                vegaSpec: null,
                dataSource: null,
            },
        });
    }

    public willExecute(context: TaskExecutionContext): void {
        this.configure(context);
    }

    public async execute(ctx: TaskExecutionContext): Promise<void> {
        // Get viz info
        if (!this._card) return;
        const oid = this.buffer.objectId();
        const target = this._card.vizTarget()!;
        let cardUpdate: Partial<model.CardSpecification> & { objectId: number } = {
            objectId: oid,
            timeUpdated: new Date(),
        };

        // Create
        switch (this._renderer) {
            case model.CardRendererType.BUILTIN_TABLE: {
                await ctx.database.evaluateTableStatistics(target);
                await this._rowCount!;
                cardUpdate = {
                    ...cardUpdate,
                    cardRenderer: model.CardRendererType.BUILTIN_TABLE,
                    dataSource: {
                        dataResolver: CardDataResolver.PIECEWISE_SCAN,
                        targetQualified: this._table!.nameQualified,
                        filters: null,
                        aggregates: null,
                        orderBy: null,
                        m5Config: null,
                        sampleSize: 0,
                    },
                };
                break;
            }
            case model.CardRendererType.BUILTIN_VEGA:
                await ctx.database.evaluateTableStatistics(target);
                cardUpdate = {
                    ...cardUpdate,
                    ...(await this._vega!.compile()),
                };
                break;
            case model.CardRendererType.BUILTIN_JSON:
            case model.CardRendererType.BUILTIN_HEX:
                cardUpdate = {
                    ...cardUpdate,
                    cardRenderer: this._renderer,
                    dataSource: {
                        dataResolver: CardDataResolver.PIECEWISE_SCAN,
                        targetQualified: this._card.vizTarget()!,
                        filters: null,
                        aggregates: null,
                        orderBy: null,
                        m5Config: null,
                        sampleSize: 0,
                    },
                };
                break;
        }
        ctx.planContextDiff.push({
            type: UPDATE_CARD,
            data: cardUpdate,
        });
    }
}

export class UpdateVizTaskLogic extends CreateVizTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.ProgramTask, statement: model.Statement) {
        super(task_id, task, statement);
    }

    // XXX do not recompile vega spec every time
}

export class DropVizTaskLogic extends SetupTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(ctx: TaskExecutionContext): Promise<void> {
        const objectId = this.buffer.objectId();
        ctx.planContextDiff.push({
            type: DELETE_CARD,
            data: objectId,
        });
    }
}
