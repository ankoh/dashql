// Copyright (c) 2020 The DashQL Authors

import * as Immutable from 'immutable';
import { Program } from './program';
import * as proto from '@dashql/proto';

export class ProgramInstance {
    /// The program
    public readonly program: Program;
    /// The input values
    public readonly inputValues: Immutable.List<any>;
    /// The instantiated program
    public readonly annotations: proto.analyzer.ProgramAnnotations;
    /// The time when the program was created
    public readonly createdAt: Date;
    /// The fetch statements
    public readonly fetchStatements: Map<number, proto.analyzer.FetchStatement>;
    /// The fetch statements
    public readonly transformStatements: Map<number, proto.analyzer.TransformStatement>;
    /// The fetch statements
    public readonly loadStatements: Map<number, proto.analyzer.LoadStatement>;
    /// The cards
    public readonly cards: Map<number, proto.analyzer.Card>;

    /// Constructor
    public constructor(
        program: Program,
        inputValues: Immutable.List<any>,
        annotations: proto.analyzer.ProgramAnnotations,
    ) {
        this.program = program;
        this.inputValues = inputValues;
        this.annotations = annotations;
        this.createdAt = new Date();
        this.fetchStatements = new Map();
        this.transformStatements = new Map();
        this.loadStatements = new Map();
        this.cards = new Map();
        for (let i = 0; i < annotations.statementsFetchLength(); ++i) {
            const s = annotations.statementsFetch(i)!;
            this.fetchStatements.set(s.statementId(), s);
        }
        for (let i = 0; i < annotations.statementsTransformLength(); ++i) {
            const s = annotations.statementsTransform(i)!;
            this.transformStatements.set(s.statementId(), s);
        }
        for (let i = 0; i < annotations.statementsLoadLength(); ++i) {
            const s = annotations.statementsLoad(i)!;
            this.loadStatements.set(s.statementId(), s);
        }
        for (let i = 0; i < annotations.cardsLength(); ++i) {
            const spec = annotations.cards(i)!;
            this.cards.set(spec.statementId(), spec);
        }
    }
}
