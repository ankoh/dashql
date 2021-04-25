import * as arrow from 'apache-arrow';
import * as duckdb from '@dashql/duckdb/src/';
import * as SQL from 'sql.js';
import alasql from 'alasql';
import * as aq from 'arquero';
import { nSQL } from '@nano-sql/core';
import * as lf from 'lovefield-ts/dist/es6/lf.js';

export interface DBWrapper {
    name: string;

    init(): void;
    close(): void;
    create(table: string, columns: { [key: string]: string }): void;
    load(table: string, data: { [key: string]: any }[]): void;
    scan_int(table: string): void;
    sum(table: string, column: string): number;
}

function noop() {}

function sqlCreate(table: string, columns: { [key: string]: string }): string {
    let sql = `CREATE TABLE IF NOT EXISTS ${table} (`;
    for (const col of Object.getOwnPropertyNames(columns)) {
        sql += col + ' ' + columns[col] + ',';
    }
    return sql.substr(0, sql.length - 1) + ')';
}

function sqlInsert(table: string, data: { [key: string]: any }[]): string {
    let query = `INSERT INTO ${table}(`;
    const keys = Object.getOwnPropertyNames(data[0]);
    for (let i = 0; i < keys.length; i++) {
        query += keys[i];
        if (i < keys.length - 1) query += ',';
    }
    query += ') VALUES ';

    for (let i = 0; i < data.length; i++) {
        query += '(';
        for (let j = 0; j < keys.length; j++) {
            query += JSON.stringify(data[i][keys[j]]);
            if (j < keys.length - 1) query += ',';
        }
        query += ')';
        if (i < data.length - 1) query += ',';
    }

    return query;
}

export class DuckDBMatWrapper implements DBWrapper {
    public name: string;
    private conn?: duckdb.DuckDBConnection;
    private db: duckdb.DuckDBBindings;

    constructor(db: duckdb.DuckDBBindings) {
        this.name = 'DuckDB-mat';
        this.db = db;
    }

    init(): void {
        this.conn = this.db.connect();
    }
    close(): void {
        this.conn!.disconnect();
    }
    create(table: string, columns: { [key: string]: string }): void {
        this.conn!.runQuery(sqlCreate(table, columns));
    }
    load(table: string, data: { [key: string]: any }[]): void {
        this.conn!.runQuery(sqlInsert(table, data));
    }
    scan_int(table: string): void {
        const results = this.conn!.runQuery<{ a_value: arrow.Int32 }>(`SELECT a_value FROM ${table}`);
        for (const v of results.getColumnAt(0)!) {
            noop();
        }
    }
    sum(table: string, column: string): number {
        throw new Error('Method not implemented.');
    }
}

export class DuckDBStreamWrapper implements DBWrapper {
    public name: string;
    private conn?: duckdb.DuckDBConnection;
    private db: duckdb.DuckDBBindings;

    constructor(db: duckdb.DuckDBBindings) {
        this.name = 'DuckDB-str';
        this.db = db;
    }

    init(): void {
        this.conn = this.db.connect();
    }
    close(): void {
        this.conn!.disconnect();
    }
    create(table: string, columns: { [key: string]: string }): void {
        this.conn!.runQuery(sqlCreate(table, columns));
    }
    load(table: string, data: { [key: string]: any }[]): void {
        this.conn!.runQuery(sqlInsert(table, data));
    }
    scan_int(table: string): void {
        const results = this.conn!.sendQuery<{ a_value: arrow.Int32 }>(`SELECT a_value FROM ${table}`);
        for (const batch of results) {
            for (const v of batch.getChildAt(0)!) {
                noop();
            }
        }
    }
    sum(table: string, column: string): number {
        throw new Error('Method not implemented.');
    }
}

export class SQLjsWrapper implements DBWrapper {
    name: string;
    db: SQL.Database;

    constructor(db: SQL.Database) {
        this.name = 'sql.js';
        this.db = db;
    }

    init(): void {}
    close(): void {}
    create(table: string, columns: { [key: string]: string }): void {
        this.db.run(sqlCreate(table, columns));
    }
    load(table: string, data: { [key: string]: any }[]): void {
        this.db.run(sqlInsert(table, data));
    }
    scan_int(table: string): void {
        const results = this.db.exec(`SELECT a_value FROM ${table}`);
        for (const row of results[0].values) {
            noop();
        }
    }
    sum(table: string, column: string): number {
        throw new Error('Method not implemented.');
    }
}

export class AlaSQLWrapper implements DBWrapper {
    name: string;

    constructor() {
        this.name = 'AlaSQL';
    }

    init(): void {}
    close(): void {}
    create(table: string, columns: { [key: string]: string }): void {
        alasql(sqlCreate(table, columns));
    }
    load(table: string, data: { [key: string]: any }[]): void {
        alasql(sqlInsert(table, data));
    }
    scan_int(table: string): void {
        const rows = alasql(`SELECT a_value FROM ${table}`);
        for (const row of rows) {
            noop();
        }
    }
    sum(table: string, column: string): number {
        throw new Error('Method not implemented.');
    }
}

export class LovefieldWrapper implements DBWrapper {
    name: string;
    builder?: lf.Builder;
    db?: lf.DatabaseConnection;

    constructor() {
        this.name = 'Lovefield';
    }
    init(): void {
        this.builder = lf.schema.create('test_schema', 1);
    }
    close(): void {
        this.db!.close();
        this.db = undefined;
    }
    create(table: string, columns: { [key: string]: string }): void {
        if (this.db) {
            throw 'Schema is fixed after first insert.';
        }

        let tableBuilder = this.builder!.createTable(table);
        let type: lf.Type;
        for (const col of Object.getOwnPropertyNames(columns)) {
            switch (columns[col]) {
                case 'INTEGER': {
                    type = lf.Type.INTEGER;
                    break;
                }
                default:
                    throw 'Unknown column type ' + columns[col];
            }

            tableBuilder = tableBuilder.addColumn(col, type);
        }
    }
    async load(table: string, data: { [key: string]: any }[]): Promise<void> {
        if (!this.db) {
            this.db = await this.builder!.connect({ storeType: lf.DataStoreType.MEMORY });
        }
        let rows = [];
        const t = this.db!.getSchema().table(table);
        for (const row of data) {
            rows.push(t.createRow(row));
        }

        await this.db!.insert().into(t).values(rows).exec();
    }
    async scan_int(table: string): Promise<void> {
        const rows = <{ a_value: number }[]>await this.db!.select().from(this.db!.getSchema().table(table)).exec();
        for (const row of rows) {
            noop();
        }
    }
    sum(table: string, column: string): number {
        throw new Error('Method not implemented.');
    }
}

export class ArqueroWrapper implements DBWrapper {
    name: string;
    schemas: { [key: string]: { [key: string]: string } } = {};
    tables: { [key: string]: aq.internal.Table } = {};

    constructor() {
        this.name = 'Arquero';
    }
    init(): void {}
    close(): void {
        this.tables = {};
        this.schemas = {};
    }
    create(table: string, columns: { [key: string]: string }): void {
        this.schemas[table] = columns;
    }
    load(table: string, data: { [key: string]: any }[]): void {
        let cols: { [key: string]: any } = {};
        const keys = Object.getOwnPropertyNames(data[0]);
        for (const k of keys) {
            cols[k] = [];
        }
        for (const row of data) {
            for (const k of keys) {
                (<any[]>cols[k]).push(row[k]);
            }
        }
        for (const k of keys) {
            switch (this.schemas[table][k]) {
                case 'INTEGER': {
                    cols[k] = new Int32Array(<number[]>cols[k]);
                    break;
                }
                default:
                    throw 'Unhandled type ' + this.schemas[table][k];
            }
        }
        this.tables[table] = aq.table(cols);
    }
    scan_int(table: string): void {
        for (const row of this.tables[table].objects()) {
            noop();
        }
    }
    sum(table: string, column: string): number {
        throw new Error('Method not implemented.');
    }
}

export class NanoSQLWrapper implements DBWrapper {
    name: string;

    constructor() {
        this.name = 'nanoSQL';
    }
    async init(): Promise<void> {
        await nSQL().createDatabase({
            id: 'test_schema',
            mode: 'TEMP',
        });
        nSQL().useDatabase('test_schema');
    }
    async close(): Promise<void> {
        await nSQL().disconnect();
    }
    async create(table: string, columns: { [key: string]: string }): Promise<void> {
        let model: any = {};
        for (const k of Object.getOwnPropertyNames(columns)) {
            switch (columns[k]) {
                case 'INTEGER': {
                    model[`${k}:int`] = {};
                    break;
                }
                default:
                    throw 'Unhandled type ' + columns[k];
            }
        }
        await nSQL().query('create table', { name: table, model: model }).exec();
    }
    async load(table: string, data: { [key: string]: any }[]): Promise<void> {
        await nSQL(table).loadJS(data);
    }
    async scan_int(table: string): Promise<void> {
        for (const row of await nSQL(table).query('select', ['a_value']).exec()) {
            noop();
        }
    }
    sum(table: string, column: string): number {
        throw new Error('Method not implemented.');
    }
}

export class PlainJSWrapper implements DBWrapper {
    name: string;
    tables: { [key: string]: { [key: string]: any }[] } = {};

    constructor() {
        this.name = 'Plain JS';
    }
    init(): void {}
    close(): void {
        this.tables = {};
    }
    create(table: string, columns: { [key: string]: string }): void {}
    load(table: string, data: { [key: string]: any }[]): void {
        this.tables[table] = data;
    }
    scan_int(table: string): void {
        for (const row of this.tables[table]) {
            noop();
        }
    }
    sum(table: string, column: string): number {
        throw new Error('Method not implemented.');
    }
}
