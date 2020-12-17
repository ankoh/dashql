import { Program } from "../model";
import { Plan } from "../model";

export interface CoreWasmAPI {
    parseProgram(text: string): Promise<Program>;
    planProgram(): Promise<Plan>;
}
