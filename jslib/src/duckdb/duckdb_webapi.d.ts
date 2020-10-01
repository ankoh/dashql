interface DuckDBModule extends EmscriptenModule {}
export function DuckDB(moduleOverrides?: Partial<DuckDBModule>,): Promise<DuckDBModule>;
export default DuckDB;
