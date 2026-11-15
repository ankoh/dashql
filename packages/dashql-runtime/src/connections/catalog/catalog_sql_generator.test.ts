import * as dashql from '@ankoh/dashql-core';
import { describe, expect, it } from 'vitest';

import { quoteDataType, generateQualifiedTableName, generateCreateTableSQL, relationFilter, catalogTablesOfDescriptor, generateCatalogTablesSQL, generateRelationsFile, packCatalogDescriptor, type CatalogTable, type ColumnMetadata } from './catalog_sql_generator.js';
import { quoteIdentifier } from '../../utils/sql_quote.js';

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

    it('selects a name without a schema in every schema, and a whole schema', () => {
        expect(relationFilter('s', 't', [{ databaseName: 'db', schemaName: '', tableName: 'a' }])).toBe("((t = 'a'))");
        expect(relationFilter('s', 't', [{ databaseName: 'db', schemaName: 'x', tableName: '' }])).toBe("((s = 'x'))");
    });
});
