import * as dashql from '../src/index.js';

interface TestTable {
    name: string;
    columns: string[];
}

export function table(name: string, columns: string[] = []): TestTable {
    return {
        name,
        columns,
    };
}

export function expectTables(
    _parsed: dashql.buffers.parser.ParsedScript,
    analyzed: dashql.buffers.analyzer.AnalyzedScript,
    tables: TestTable[],
) {
    expect(analyzed.tablesLength()).toEqual(tables.length);
    for (let i = 0; i < tables.length; ++i) {
        const table = analyzed.tables(i)!;
        const tableName = table.tableName()!;
        expect(tableName.tableName()).toEqual(tables[i].name);
        const tmp = new dashql.buffers.analyzer.TableColumn();
        for (let j = 0; j < tables[i].columns.length; ++j) {
            expect(j).toBeLessThan(table.tableColumnsLength());
            const column = table.tableColumns(j, tmp)!;
            const columnName = column.columnName();
            expect(columnName).toEqual(tables[i].columns[j]);
        }
    }
}
