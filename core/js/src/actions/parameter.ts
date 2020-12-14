import { ProgramAction } from "./action";
import { Program, Statement } from "../model";

export class ParameterAction extends ProgramAction {
    constructor(program: Program, statement: Statement) {
        super(program, statement);
    }
};
