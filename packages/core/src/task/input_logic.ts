// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import * as model from '../model';
import * as error from '../error';
import { ADD_CARD, DELETE_CARD } from '../model/plan_context';
import { TaskHandle, Statement, CardRendererType } from '../model';
import { ProgramTaskLogic, SetupTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';

export class InputTaskLogic extends ProgramTaskLogic {
    /// The viz spec
    _card: proto.analyzer.Card | null = null;

    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: Statement) {
        super(task_id, task, statement);
    }

    public prepare(ctx: TaskExecutionContext): void {
        if (!ctx.planContext.plan) return;
        // Get the program instance
        const instance = ctx.planContext.plan.programInstance;
        const stmt = instance.program.getStatement(this.origin.statementId);
        // Get card
        this._card = instance.cards.get(this.origin.statementId) || null;
        if (!this._card) {
            throw new error.TaskLogicError('card does not exist', instance);
        }
        // Get the input component type
        let renderer = null;
        const inputName = stmt.namePretty;
        const inputValueType = this._card.inputValueType();
        switch (this._card.inputComponent()) {
            case proto.syntax.InputComponentType.TEXT:
                renderer = CardRendererType.BUILTIN_INPUT_TEXT;
                break;
            case proto.syntax.InputComponentType.CALENDAR:
                renderer = CardRendererType.BUILTIN_INPUT_CALENDAR;
                break;
            case proto.syntax.InputComponentType.NONE:
                switch (inputValueType.typeId()) {
                    case proto.sql.SQLTypeID.ANY:
                    case proto.sql.SQLTypeID.INTEGER:
                        renderer = CardRendererType.BUILTIN_INPUT_TEXT;
                        break;
                    case proto.sql.SQLTypeID.DATE:
                        renderer = CardRendererType.BUILTIN_INPUT_CALENDAR;
                        break;
                    default:
                        renderer = CardRendererType.BUILTIN_INPUT_TEXT;
                        break;
                }
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
                nameQualified: stmt.nameQualified,
                cardType: proto.analyzer.CardType.BUILTIN_INPUT,
                cardRenderer: renderer,
                statementID: this.origin.statementId,
                position: pos,
                title: inputName,
                inputValueType: inputValueType,
                inputExtra: JSON.parse(this._card.inputExtra() || '') as model.InputExtra,
            },
        });
    }

    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(_ctx: TaskExecutionContext): Promise<void> {}
}

export class DropInputTaskLogic extends SetupTaskLogic {
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

export class ImportInputTaskLogic extends SetupTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(_ctx: TaskExecutionContext): Promise<void> {}
}
