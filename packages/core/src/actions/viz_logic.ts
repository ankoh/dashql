import * as proto from '@dashql/proto';
import * as model from '../model';
import * as error from '../error';
import * as arrow from 'apache-arrow';
import { VegaComposer } from '../viz/vega_composer';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export abstract class VizActionLogic extends ProgramActionLogic {
    /// The viz spec
    _card: proto.analyzer.Card | null = null;
    /// The renderer
    _renderer: model.CardRendererType = model.CardRendererType.BUILTIN_DUMP;
    /// The viz composer
    _vega: VegaComposer | null = null;
    /// The table (if needed)
    _table: model.TableSummary | null = null;
    /// The promise to get the row count (if needed)
    _rowCount: Promise<arrow.Column> | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    /// Configure the visualization
    public configure(context: ActionContext): void {
        // Select the renderer
        const instance = context.plan.programInstance;
        const target = this._card.vizTarget();
        this.selectRenderer(context, instance);

        // Helper to check if a name refers to a table
        const requireTable = (name: string) => {
            const table = context.platform._databaseManager.resolveTableName(name);
            if (table) return table;
            throw new error.ActionLogicError(`renderer requires ${name} to be a SQL Table or SQL View`, instance);
        };

        // Prepare the renderers
        switch (this._renderer) {
            case model.CardRendererType.BUILTIN_VEGA: {
                // Make sure a table with that name exists
                this._table = requireTable(target);
                // Configure the vega composer
                this.configureVegaComposer(context, this._table);
                break;
            }
            case model.CardRendererType.BUILTIN_TABLE: {
                // Make sure a table with that name exists
                this._table = requireTable(target);
                // Request the row count
                this._rowCount = context.platform.database.requestTableStatistics(
                    target,
                    model.TableStatisticsType.COUNT_STAR,
                );
                break;
            }
            case model.CardRendererType.BUILTIN_DUMP:
                // XXX Make sure a blob with that name exists
                break;
        }
    }

    /// Select the renderer
    public selectRenderer(context: ActionContext, programInstance: model.ProgramInstance): void {
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
                case proto.syntax.VizComponentType.VEGA:
                    require = model.CardRendererType.BUILTIN_VEGA;
                    break;
                case proto.syntax.VizComponentType.DUMP:
                    require = model.CardRendererType.BUILTIN_DUMP;
                    break;
                case proto.syntax.VizComponentType.TABLE:
                    require = model.CardRendererType.BUILTIN_TABLE;
                    break;
            }
            if (renderer != null && renderer != require) {
                throw new error.ActionLogicError(
                    `incompatible viz renderers: assumed ${require}, no require ${require}`,
                    programInstance,
                );
            }
            renderer = require;
        }
        this._renderer = renderer;
    }

    /// Read context info
    public configureVegaComposer(context: ActionContext, table: model.TableSummary): void {
        // Build the composer
        const stats = context.platform._databaseManager.resolveTableStatistics(table.nameQualified)!;
        this._vega = new VegaComposer(stats);

        // Read the component specs and add them to the composer
        for (let i = 0; i < this._card.vizComponentsLength(); ++i) {
            const c = this._card.vizComponents(i)!;
            const type = c.type()!;
            const mods: Map<proto.syntax.VizComponentTypeModifier, boolean> = new Map();
            for (let j = 0; j < c.typeModifiersLength(); ++i) {
                mods.set(c.typeModifiers(j)!, true);
            }
            const optionsJSON = c.options() || '';
            const options = JSON.parse(optionsJSON);
            this._vega.addComponent(type, mods, options)!;
        }

        // Combine all the components
        this._vega.combineComponents();
    }
}

export class CreateVizActionLogic extends VizActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    /// Prepare the viz creation
    public prepare(context: ActionContext): void {
        // Get the program instance
        const programInstance = context.plan.programInstance;
        // Get viz spec
        this._card = programInstance.cards.get(this.origin.statementId) || null;
        if (!this._card) {
            throw new error.ActionLogicError('card proto does not exist', programInstance);
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
        const info: model.CardSpecification = {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.CARD_SPECIFICATION,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this.buffer.nameQualified() || '',
            cardType: proto.analyzer.CardType.BUILTIN_VIZ,
            cardRenderer: null,
            statementID: this.origin.statementId,
            position: pos,
            title: this._card!.cardTitle() || null,
            inputOptions: null,
            vegaLiteSpec: null,
            vegaSpec: null,
            dataSource: null,
            visible: true,
        };
        context.stagedObjects.push(info);
    }

    public willExecute(context: ActionContext): void {
        this.configure(context);
    }

    public async execute(context: ActionContext): Promise<void> {
        // Get viz info
        const oid = this.buffer.objectId();
        const state = context.platform.store.getState();
        const target = this._card.vizTarget();
        let card = model.resolveCardById(state.core.planState, oid);

        // Create
        switch (this._renderer) {
            case model.CardRendererType.BUILTIN_TABLE: {
                await context.platform.database.evaluateTableStatistics(target);
                await this._rowCount!;
                card = {
                    ...card,
                    cardRenderer: model.CardRendererType.BUILTIN_TABLE,
                    dataSource: {
                        dataResolver: null,
                        targetQualified: this._table.nameQualified,
                        filters: null,
                        aggregates: null,
                        orderBy: null,
                        m5Config: null,
                        sampleSize: null,
                    },
                    timeUpdated: new Date(),
                };
                break;
            }
            case model.CardRendererType.BUILTIN_VEGA:
                await context.platform.database.evaluateTableStatistics(target);
                card = {
                    ...card,
                    ...(await this._vega!.compile()),
                    timeUpdated: new Date(),
                };
                break;
        }

        model.mutate(context.platform.store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [card],
        });
    }
}

export class UpdateVizActionLogic extends CreateVizActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    // XXX do not recompile vega spec every time
}

export class DropVizActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepare(_context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}
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

    public prepare(_context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}
    public async execute(_context: ActionContext): Promise<void> {}
}
