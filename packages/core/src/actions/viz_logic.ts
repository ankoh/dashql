import * as proto from '@dashql/proto';
import * as model from '../model';
import * as error from '../error';
import * as arrow from 'apache-arrow';
import { VizComposer } from '../viz/viz_composer';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export abstract class VizActionLogic extends ProgramActionLogic {
    /// The viz spec
    _card: proto.analyzer.Card | null = null;
    /// The viz composer
    _vizComposer: VizComposer | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    /// Get the qualified table name
    protected get tableNameQualified(): string {
        return this.buffer.targetNameQualified()!;
    }

    /// Read context info
    public configureVizComposer(context: ActionContext): void {
        // Get the table info
        const programInstance = context.plan.programInstance;
        const store = context.platform.store;
        const tableInfo = store.getState().core.planState.tables.get(this.tableNameQualified) || null;
        if (!tableInfo) {
            throw new error.ActionLogicError(`target table ${this.tableNameQualified} does not exist`, programInstance);
        }
        // Build the composer
        const stats = context.platform._databaseManager.resolveTableStatistics(tableInfo.tableNameQualified)!;
        this._vizComposer = new VizComposer(stats);

        // Read the component specs and add them to the compose
        for (let i = 0; i < this._card.vizComponentsLength(); ++i) {
            const c = this._card.vizComponents(i)!;
            const type = c.type()!;
            const mods: Map<proto.syntax.VizComponentTypeModifier, boolean> = new Map();
            for (let j = 0; j < c.typeModifiersLength(); ++i) {
                mods.set(c.typeModifiers(j)!, true);
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
    _rowCountPromise: Promise<arrow.Column> | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepare(context: ActionContext, planObjects: model.PlanObject[]): void {
        // Get the program instance
        const programInstance = context.plan.programInstance;
        // Get viz spec
        this._card = programInstance.cards.get(this.origin.statementId) || null;
        if (!this._card) {
            throw new error.ActionLogicError('card spec does not exist', programInstance);
        }
        // Get position
        const posReader = this._card!.position()!;
        const pos: model.CardPosition = {
            row: posReader.row(),
            column: posReader.column(),
            width: posReader.width(),
            height: posReader.height(),
        };
        const now = new Date();
        const info: model.Card = {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.CARD,
            timeCreated: now,
            timeUpdated: now,
            cardType: proto.analyzer.CardType.BUILTIN_VIZ,
            cardRenderer: null,
            statementID: this.origin.statementId,
            position: pos,
            title: this._card!.title() || null,
            inputOptions: null,
            vegaLiteSpec: null,
            vegaSpec: null,
            dataSource: null,
        };
        planObjects.push(info);
    }

    public willExecute(context: ActionContext): void {
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
        let card = state.core.planState.cards.get(oid) as model.Card;
        console.assert(card !== undefined, 'missing initial card object');

        // Create new viz object
        const now = new Date();
        const spec = await this._vizComposer!.compile();
        card = {
            ...card,
            ...spec,
            timeUpdated: now,
        };

        model.mutate(context.platform.store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [card],
        });
    }
}

export class UpdateVizActionLogic extends VizActionLogic {
    /// The promise to get the row count
    _rowCountPromise: Promise<arrow.Column> | null = null;

    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepare(context: ActionContext, planObjects: model.PlanObject[]): void {
        const programInstance = context.plan.programInstance;
        const state = context.platform.store.getState();
        const objectID = this.buffer.objectId().toString();
        const cardObject = state.core.planState.cards.get(objectID);
        if (!cardObject) {
            throw new error.ActionLogicError('card object does not exist', context.plan.programInstance);
        }

        this._card = programInstance.cards.get(this.origin.statementId) || null;
        if (!this._card) {
            throw new error.ActionLogicError('card spec does not exist', context.plan.programInstance);
        }

        const posReader = this._card!.position()!;
        const pos: model.CardPosition = {
            row: posReader.row(),
            column: posReader.column(),
            width: posReader.width(),
            height: posReader.height(),
        };
        const now = new Date();
        const next: model.Card = {
            ...cardObject,
            timeUpdated: now,
            cardRenderer: null,
            statementID: this.origin.statementId,
            position: pos,
            title: this._card!.title() || null,
            vegaLiteSpec: null,
            vegaSpec: null,
            dataSource: null,
        };
        planObjects.push(next);
    }

    public willExecute(context: ActionContext): void {
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
        let card = state.core.planState.cards.get(oid) as model.Card;
        console.assert(card !== undefined, 'missing initial card object');

        // Create new viz object
        const now = new Date();
        const spec = await this._vizComposer!.compile();
        card = {
            ...card,
            ...spec,
            timeUpdated: now,
        };
        model.mutate(context.platform.store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [card],
        });
    }
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
