import { Statement, Program } from "../model";

export class Action {
    /// A program
    program: Program;

    constructor(program: Program) {
        this.program = program;
    }
}

export class ProgramAction extends Action {
    /// The origin statement
    origin: Statement;

    constructor(program: Program, origin: Statement) {
        super(program);
        this.origin = origin;
    }
}

export class SetupAction extends Action {
    constructor(program: Program) {
        super(program);
    }
}
