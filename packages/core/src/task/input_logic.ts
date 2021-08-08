import * as proto from '@dashql/proto';
import * as model from '../model';
import * as error from '../error';
import { TaskHandle, Statement, CardRendererType } from '../model';
import { ProgramTaskLogic, SetupTaskLogic } from './task_logic';
import { TaskContext } from './task_context';

export class InputTaskLogic extends ProgramTaskLogic {
    /// The viz spec
    _card: proto.analyzer.Card | null = null;

    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: Statement) {
        super(task_id, task, statement);
    }

    public prepare(context: TaskContext): void {
        // Get the program instance
        const instance = context.plan.programInstance;
        const stmt = instance.program.getStatement(this.origin.statementId);
        // Get card
        this._card = instance.cards.get(this.origin.statementId) || null;
        if (!this._card) {
            throw new error.TaskLogicError('card does not exist', instance);
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
            nameQualified: stmt.nameQualified,
            cardType: proto.analyzer.CardType.BUILTIN_INPUT,
            cardRenderer: renderer,
            statementID: this.origin.statementId,
            position: pos,
            title: this._card!.cardTitle() || stmt.nameQualified || null,
            inputExtra: JSON.parse(this._card.inputExtra()) as model.InputExtra,
            vegaLiteSpec: null,
            vegaSpec: null,
            dataSource: null,
            visible: true,
        };
        context.stagedObjects.push(info);
    }

    public willExecute(_context: TaskContext): void {}
    public async execute(_context: TaskContext): Promise<void> {}
}

export class DropInputTaskLogic extends SetupTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_context: TaskContext): void {}
    public willExecute(_context: TaskContext): void {}
    public async execute(context: TaskContext): Promise<void> {
        const store = context.platform.store!;
        const objectId = this.buffer.objectId();
        model.mutate(store.dispatch, {
            type: model.StateMutationType.DELETE_PLAN_OBJECTS,
            data: [objectId],
        });
    }
}

export class ImportInputTaskLogic extends SetupTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_context: TaskContext): void {}
    public willExecute(_context: TaskContext): void {}
    public async execute(_context: TaskContext): Promise<void> {}
}
