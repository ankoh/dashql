import { DashQLCoreModule } from './core_wasm_module';
export function DashQLCore(moduleOverrides?: Partial<DashQLCoreModule>,): Promise<DashQLCoreModule>;
export default DashQLCore;
