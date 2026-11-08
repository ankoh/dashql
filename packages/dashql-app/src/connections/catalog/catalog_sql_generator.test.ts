import * as dashql from '@ankoh/dashql-core';
import * as arrow from 'apache-arrow';
import * as flatbuffers from 'flatbuffers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateCatalogSQLFromPgProc, queryPgProc } from './catalog_query_pg_proc.js';
import type { QueryExecutor } from '../query_executor.js';

import {
    quoteIdentifier,
    quoteDataType,
    generateQualifiedTableName,
    generateCreateTableSQL,
    generateSchemaSQL,
    generateUnqualifiedSchemaSQL,
    generateCatalogSQL,
    relationFilter,
    catalogTablesOfDescriptor,
    generateCatalogTablesSQL,
    generateRelationsFile,
    packCatalogDescriptor,
    type CatalogTable,
    type ColumnMetadata,
    type SchemaMetadata
} from './catalog_sql_generator.js';
import { tableFromArrays, vectorFromArray } from '../../tests/arrow_fixtures.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

describe('SQL Generator Utilities', () => {
    describe('quoteIdentifier', () => {
        it('quotes simple identifiers', () => {
            expect(quoteIdentifier('users')).toBe('"users"');
            expect(quoteIdentifier('my_table')).toBe('"my_table"');
        });

        it('quotes identifiers with spaces', () => {
            expect(quoteIdentifier('user table')).toBe('"user table"');
            expect(quoteIdentifier('my complex name')).toBe('"my complex name"');
        });

        it('escapes internal double quotes', () => {
            expect(quoteIdentifier('user"name')).toBe('"user""name"');
            expect(quoteIdentifier('test"with"quotes')).toBe('"test""with""quotes"');
        });

        it('handles special characters', () => {
            expect(quoteIdentifier('user-table')).toBe('"user-table"');
            expect(quoteIdentifier('table.name')).toBe('"table.name"');
            expect(quoteIdentifier('name@domain')).toBe('"name@domain"');
        });
    });

    describe('quoteDataType', () => {
        it('keeps the text of a type', () => {
            expect(quoteDataType('bigint')).toBe('"bigint"');
            expect(quoteDataType('numeric(10,2)')).toBe('"numeric(10,2)"');
            expect(quoteDataType('timestamp with time zone')).toBe('"timestamp with time zone"');
            expect(quoteDataType('USER-DEFINED')).toBe('"USER-DEFINED"');
            expect(quoteDataType('row(bigint, varchar)')).toBe('"row(bigint, varchar)"');
        });

        it('escapes quotes', () => {
            expect(quoteDataType('"char"')).toBe('"""char"""');
        });

        it('says if a type is unknown', () => {
            expect(quoteDataType(null)).toBe('"unknown"');
            expect(quoteDataType(undefined)).toBe('"unknown"');
            expect(quoteDataType('')).toBe('"unknown"');
        });
    });

    describe('generateQualifiedTableName', () => {
        it('generates fully qualified names', () => {
            expect(generateQualifiedTableName('mydb', 'myschema', 'mytable')).toBe(
                '"mydb"."myschema"."mytable"'
            );
        });

        it('uses hyper for a missing database name', () => {
            expect(generateQualifiedTableName(null, 'myschema', 'mytable')).toBe(
                '"hyper"."myschema"."mytable"'
            );
            expect(generateQualifiedTableName(undefined, 'myschema', 'mytable')).toBe(
                '"hyper"."myschema"."mytable"'
            );
        });

        it('quotes special characters in names', () => {
            expect(generateQualifiedTableName('my db', 'my schema', 'my table')).toBe(
                '"my db"."my schema"."my table"'
            );
        });
    });

    describe('generateCreateTableSQL', () => {
        it('generates simple CREATE TABLE', () => {
            const columns: ColumnMetadata[] = [
                { name: 'id', ordinalPosition: 0, dataType: 'integer' },
                { name: 'name', ordinalPosition: 1, dataType: 'varchar' }
            ];

            const sql = generateCreateTableSQL('mydb', 'myschema', 'users', columns);

            expect(sql).toContain('CREATE TABLE "mydb"."myschema"."users"');
            expect(sql).toContain('"id" "integer"');
            expect(sql).toContain('"name" "varchar"');
        });

        it('sorts columns by ordinal position', () => {
            const columns: ColumnMetadata[] = [
                { name: 'name', ordinalPosition: 1, dataType: 'varchar' },
                { name: 'id', ordinalPosition: 0, dataType: 'integer' },
                { name: 'email', ordinalPosition: 2, dataType: 'varchar' }
            ];

            const sql = generateCreateTableSQL('db', 'schema', 'users', columns);

            // ID should come first
            const idIndex = sql.indexOf('"id"');
            const nameIndex = sql.indexOf('"name"');
            const emailIndex = sql.indexOf('"email"');

            expect(idIndex).toBeLessThan(nameIndex);
            expect(nameIndex).toBeLessThan(emailIndex);
        });

        it('handles columns with null types', () => {
            const columns: ColumnMetadata[] = [
                { name: 'id', ordinalPosition: 0, dataType: null },
                { name: 'name', ordinalPosition: 1, dataType: undefined }
            ];

            const sql = generateCreateTableSQL('db', 'schema', 'users', columns);

            expect(sql).toContain('"id" "unknown"');
            expect(sql).toContain('"name" "unknown"');
        });

        it('handles special characters in column names', () => {
            const columns: ColumnMetadata[] = [
                { name: 'user id', ordinalPosition: 0, dataType: 'integer' },
                { name: 'user"name', ordinalPosition: 1, dataType: 'varchar' }
            ];

            const sql = generateCreateTableSQL('db', 'schema', 'users', columns);

            expect(sql).toContain('"user id" "integer"');
            expect(sql).toContain('"user""name" "varchar"');
        });
    });

    describe('generateSchemaSQL', () => {
        it('generates SQL for multiple tables', () => {
            const tables = new Map<string, ColumnMetadata[]>();
            tables.set('users', [
                { name: 'id', ordinalPosition: 0, dataType: 'integer' },
                { name: 'name', ordinalPosition: 1, dataType: 'varchar' }
            ]);
            tables.set('posts', [
                { name: 'id', ordinalPosition: 0, dataType: 'integer' },
                { name: 'title', ordinalPosition: 1, dataType: 'varchar' }
            ]);

            const sql = generateSchemaSQL('mydb', 'public', tables);

            expect(sql).toContain('CREATE TABLE "mydb"."public"."posts"');
            expect(sql).toContain('CREATE TABLE "mydb"."public"."users"');
        });

        it('sorts tables alphabetically', () => {
            const tables = new Map<string, ColumnMetadata[]>();
            tables.set('zebra', [
                { name: 'id', ordinalPosition: 0, dataType: 'integer' }
            ]);
            tables.set('apple', [
                { name: 'id', ordinalPosition: 0, dataType: 'integer' }
            ]);

            const sql = generateSchemaSQL('db', 'schema', tables);

            const appleIndex = sql.indexOf('"apple"');
            const zebraIndex = sql.indexOf('"zebra"');

            expect(appleIndex).toBeLessThan(zebraIndex);
        });

        it('handles empty table map', () => {
            const tables = new Map<string, ColumnMetadata[]>();
            const sql = generateSchemaSQL('db', 'schema', tables);
            expect(sql).toBe('');
        });
    });

    describe('generateUnqualifiedSchemaSQL', () => {
        it('generates tables without database or schema qualifiers', () => {
            const tables = new Map<string, ColumnMetadata[]>();
            tables.set('Account__dll', [
                { name: 'Id__c', ordinalPosition: 0, dataType: 'text' }
            ]);

            const sql = generateUnqualifiedSchemaSQL(tables);

            expect(sql).toBe('CREATE TABLE "Account__dll" (\n    "Id__c" "text"\n);');
            expect(sql).not.toContain('"salesforce"."datacloud"');
        });
    });

    describe('generateCatalogSQL', () => {
        it('generates SQL for multiple schemas', () => {
            const schemas: SchemaMetadata[] = [
                {
                    databaseName: 'db1',
                    schemaName: 'schema1',
                    tables: [
                        {
                            tableName: 'users',
                            columns: [
                                { name: 'id', ordinalPosition: 0, dataType: 'integer' },
                                { name: 'name', ordinalPosition: 1, dataType: 'varchar' }
                            ]
                        }
                    ]
                },
                {
                    databaseName: 'db1',
                    schemaName: 'schema2',
                    tables: [
                        {
                            tableName: 'posts',
                            columns: [
                                { name: 'id', ordinalPosition: 0, dataType: 'integer' },
                                { name: 'title', ordinalPosition: 1, dataType: 'varchar' }
                            ]
                        }
                    ]
                }
            ];

            const sql = generateCatalogSQL(schemas);

            expect(sql).toContain('CREATE TABLE "db1"."schema1"."users"');
            expect(sql).toContain('CREATE TABLE "db1"."schema2"."posts"');
        });

        it('handles null database names', () => {
            const schemas: SchemaMetadata[] = [
                {
                    databaseName: null,
                    schemaName: 'public',
                    tables: [
                        {
                            tableName: 'users',
                            columns: [
                                { name: 'id', ordinalPosition: 0, dataType: 'integer' }
                            ]
                        }
                    ]
                }
            ];

            const sql = generateCatalogSQL(schemas);

            expect(sql).toContain('CREATE TABLE "hyper"."public"."users"');
        });
    });
});

describe('PostgreSQL function SQL descriptors', () => {
    let dql: dashql.DashQL;
    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });
    afterEach(() => dql.resetUnsafe());

    it('queries structured types/names/modes and scalar result types instead of display signatures or defaults', async () => {
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(tableFromArrays({}))]);
        await queryPgProc('connection', vi.fn(), 1, executor);
        const sql = executor.mock.calls[0][1].query;
        expect(sql).toContain('p.proallargtypes IS NOT NULL');
        expect(sql).toContain('unnest(p.proallargtypes) WITH ORDINALITY');
        expect(sql).toContain('unnest(p.proargtypes) WITH ORDINALITY');
        expect(sql).toContain('p.proargnames AS argument_names');
        expect(sql).toContain('p.proargmodes AS argument_modes');
        expect(sql).not.toContain('array_to_json');
        expect(sql).toContain("COALESCE(pg_catalog.format_type(p.prorettype, NULL), 'any')");
        expect(sql).toContain('p.proretset AS returns_set');
        expect(sql).not.toContain('pg_get_function_arguments');
        expect(sql).not.toContain('pg_get_function_result');
    });

    it('processes multi-argument, named/defaulted, mode, array, decimal and overload signatures on the real core', () => {
        const result = tableFromArrays({
            function_schema: Array(6).fill('public'),
            function_name: ['multi', 'named_defaults', 'modes', 'arrays_decimal', 'overloaded', 'overloaded'],
            return_type: ['integer', 'numeric(12, 3)', 'bigint', 'integer[]', 'integer', 'text'],
            returns_set: Array(6).fill(false),
            function_kind: Array(6).fill('f'),
            // These display strings deliberately contain defaults, quotes and commas. They are
            // not parsed; structured catalog columns preserve the original parameter types.
            function_arguments: [
                'integer, integer',
                'input integer DEFAULT 1, "name, with quotes" text DEFAULT concat(\'a,b\', \'c\'), amount numeric(12, 3) DEFAULT 1.2',
                'IN first integer, OUT output bigint, INOUT in_out text, VARIADIC variadic_input integer[]',
                'integer[], numeric(18, 4), character varying(40), timestamp with time zone',
                'integer', 'text',
            ],
        }).assign(new arrow.Table({
            argument_types: vectorFromArray([
                ['integer', 'integer'],
                ['integer', 'text', 'numeric(12, 3)'],
                ['integer', 'bigint', 'text', 'integer[]'],
                ['integer[]', 'numeric(18, 4)', 'character varying(40)', 'timestamp with time zone'],
                ['integer'], ['text'],
            ], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
            argument_names: vectorFromArray([null, ['input', 'name, with quotes"', 'amount'], ['first', 'output', 'in_out', 'variadic_input'], [], [], []], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
            argument_modes: vectorFromArray([null, [], ['i', 'o', 'b', 'v'], [], [], []], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
        }));
        const sql = generateCatalogSQLFromPgProc(result as any, 'db');
        expect(sql).toContain('"multi"("arg1" integer, "arg2" integer)');
        expect(sql).toContain('"name, with quotes""" text');
        expect(sql).toContain('"modes"("first" integer, "in_out" text, "variadic_input" integer[])');
        expect(sql).not.toContain('DEFAULT');
        const batch = dql.processBatch({ scripts: [{ id: 'functions', text: sql, outputs: ['catalogDescriptor'] }] });
        expect(batch.scripts[0].failure).toBeUndefined();
        expect(batch.scripts[0].diagnostics).toEqual([]);
        const descriptor = dashql.buffers.catalog.CatalogDescriptor.getRootAsCatalogDescriptor(
            new flatbuffers.ByteBuffer(batch.scripts[0].catalogDescriptor!),
        );
        expect(descriptor.functionDeclarationsLength()).toBe(6);
        const functions = Array.from({ length: 6 }, (_, i) => descriptor.functionDeclarations(i)!);
        const multi = functions.find(fn => fn.functionName()?.functionName() === 'multi')!;
        expect(multi.paramsLength()).toBe(2);
        expect(multi.params(1)?.paramType()).toBe('integer');
        const named = functions.find(fn => fn.functionName()?.functionName() === 'named_defaults')!;
        expect(named.paramsLength()).toBe(3);
        expect(named.params(1)?.paramName()).toBe('name, with quotes"');
        const modes = functions.find(fn => fn.functionName()?.functionName() === 'modes')!;
        expect(modes.paramsLength()).toBe(3);
        expect(modes.params(1)?.paramName()).toBe('in_out');
        expect(modes.params(2)?.paramType()).toBe('integer[]');
        const types = functions.find(fn => fn.functionName()?.functionName() === 'arrays_decimal')!;
        expect(types.params(0)?.paramType()).toBe('integer[]');
        expect(types.params(1)?.paramType()).toBe('numeric(18, 4)');
        expect(types.returnType()).toBe('integer[]');
        const overloaded = functions.filter(fn => fn.functionName()?.functionName() === 'overloaded');
        expect(overloaded).toHaveLength(2);
        expect(overloaded.map(fn => fn.params(0)?.paramType())).toEqual(['integer', 'text']);
    });

    it('logs and skips set/table results and qualified custom types while preserving supported declarations', () => {
        const result = tableFromArrays({
            function_schema: Array(4).fill('public'), function_name: ['set_result', 'table_result', 'custom_type', 'supported'],
            return_type: ['integer', 'record', 'integer', 'integer'], returns_set: [true, false, false, false], function_kind: Array(4).fill('f'),
        }).assign(new arrow.Table({
            argument_types: vectorFromArray([['integer'], ['integer', 'text'], ['public.custom_type'], ['integer']], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
            argument_names: vectorFromArray(Array(4).fill([]), new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
            argument_modes: vectorFromArray([[], ['i', 't'], [], []], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
        }));
        const logger = { warn: vi.fn() };
        const sql = generateCatalogSQLFromPgProc(result as any, 'db', logger as any);
        expect(logger.warn).toHaveBeenCalledTimes(3);
        expect(sql).toContain('"supported"');
        expect(sql).not.toContain('"set_result"');
        expect(sql).not.toContain('"table_result"');
        expect(sql).not.toContain('"custom_type"');
        const output = dql.processBatch({ scripts: [{ id: 'functions', text: sql, outputs: ['catalogDescriptor'] }] }).scripts[0];
        expect(output.diagnostics).toEqual([]);
        expect(dashql.buffers.catalog.CatalogDescriptor.getRootAsCatalogDescriptor(new flatbuffers.ByteBuffer(output.catalogDescriptor!))
            .functionDeclarationsLength()).toBe(1);
    });
});

describe('the catalog on disk', () => {
    const TABLES: CatalogTable[] = [{
        databaseName: 'db', schemaName: 'sales', tableName: 'Orders',
        columns: [
            { name: 'zone', ordinalPosition: 1, dataType: 'text' },
            { name: 'amount', ordinalPosition: 2, dataType: 'numeric(10,2)' },
            { name: 'note "quoted"', ordinalPosition: 3, dataType: 'USER-DEFINED' },
            { name: 'plain', ordinalPosition: 4, dataType: null },
        ],
    }, {
        databaseName: 'db', schemaName: 'sales', tableName: 'tags',
        columns: [{ name: 'id', ordinalPosition: 1, dataType: 'int8' }],
    }];
    const OUTPUT = (tables: CatalogTable[]) => tables.map(table => ({
        name: `${table.databaseName}.${table.schemaName}.${table.tableName}`,
        columns: table.columns.map(column => [column.name, column.dataType]),
    }));

    it('reads back what the connection reported, columns in its order', async () => {
        const dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        const catalog = dql.createCatalog();
        const entry = catalog.allocateEntryId();
        catalog.replaceDescriptor(entry, dashql.buffers.catalog.CatalogLayer.CONNECTION, packCatalogDescriptor(TABLES));
        const before = catalogTablesOfDescriptor(catalog.readDescriptor(entry));
        expect(OUTPUT(before)).toEqual(OUTPUT(TABLES));

        // Save, then restart: the batch parses the file once into a descriptor
        const reload = (file: string) => {
            const restored = dql.processBatch({ scripts: [{ id: 'relations', text: file, outputs: ['catalogDescriptor'] }] }).scripts[0];
            expect(restored.failure).toBeUndefined();
            expect(restored.diagnostics).toEqual([]);
            const next = dql.createCatalog();
            const nextEntry = next.allocateEntryId();
            next.replaceDescriptor(nextEntry, dashql.buffers.catalog.CatalogLayer.CONNECTION, restored.catalogDescriptor!);
            return next.readDescriptor(nextEntry);
        };
        const after = reload(generateRelationsFile(catalog.readDescriptor(entry)));
        // The names and the order stay, the parser normalizes the spelling of types
        expect(OUTPUT(catalogTablesOfDescriptor(after))).toEqual([{
            name: 'db.sales.Orders',
            columns: [['zone', 'text'], ['amount', 'numeric(10,2)'], ['note "quoted"', 'user-defined'], ['plain', 'unknown']],
        }, {
            name: 'db.sales.tags',
            columns: [['id', 'bigint']],
        }]);
        // From then on the file doesn't change anymore
        const file = generateRelationsFile(after);
        expect(generateRelationsFile(reload(file))).toBe(file);
    });

    it('writes one statement per table', () => {
        expect(generateCatalogTablesSQL(TABLES).match(/CREATE TABLE/g)).toHaveLength(2);
        expect(generateRelationsFile(null)).toContain('-- DashQL Connection Relations.');
    });
});

describe('relationFilter', () => {
    it('selects relations by schema and name and quotes their names', () => {
        expect(relationFilter('s', 't', [{ databaseName: 'db', schemaName: "o'x", tableName: 'a' }, { databaseName: 'db', schemaName: 'y', tableName: 'b' }]))
            .toBe("((s = 'o''x' AND t = 'a') OR (s = 'y' AND t = 'b'))");
    });
});
