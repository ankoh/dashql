import * as proto from '@dashql/proto';
import * as model from '../model';
import * as error from '../error';
import { ActionHandle, Statement, PlanObject, CardRendererType } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export class InputActionLogic extends ProgramActionLogic {
    /// The viz spec
    _card: proto.analyzer.Card | null = null;

    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(context: ActionContext, planObjects: PlanObject[]): void {
        // Get the program instance
        const instance = context.plan.programInstance;
        const stmt = instance.program.getStatement(this.origin.statementId);
        // Get card
        this._card = instance.cards.get(this.origin.statementId) || null;
        if (!this._card) {
            throw new error.ActionLogicError('card does not exist', instance);
        }
        // Get the input component type
        let renderer = null;
        switch (this._card.inputComponent()) {
            case proto.syntax.InputComponentType.FILE:
                renderer = CardRendererType.BUILTIN_INPUT_FILE;
                break;
            case proto.syntax.InputComponentType.TEXT:
                renderer = CardRendererType.BUILTIN_INPUT_TEXT;
                break;
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
            cardType: proto.analyzer.CardType.BUILTIN_INPUT,
            cardRenderer: renderer,
            statementID: this.origin.statementId,
            position: pos,
            title: this._card!.title() || stmt.targetNameShort || null,
            inputOptions: JSON.parse(this._card.inputOptions()) as model.InputOptions,
            vegaLiteSpec: null,
            vegaSpec: null,
            dataSource: null,
        };
        planObjects.push(info);
    }

    public willExecute(_context: ActionContext) {}
    public async execute(_context: ActionContext): Promise<void> {}
}
