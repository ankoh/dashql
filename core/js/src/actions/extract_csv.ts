import { Program, Statement } from "../model";
import { ProgramAction } from "./action";

export class ExtractCSVAction extends ProgramAction {
    constructor(program: Program, statement: Statement) {
        super(program, statement);
    }
};
