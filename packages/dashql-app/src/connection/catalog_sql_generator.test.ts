import * as dashql from '../core/index.js';
import {
    quoteIdentifier,
    mapDataType,
    generateQualifiedTableName,
    generateCreateTableSQL,
    generateSchemaSQL,
    generateCatalogSQL,
    type ColumnMetadata,
    type SchemaMetadata
} from './catalog_sql_generator.js';

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

    describe('mapDataType', () => {
        it('maps integer types', () => {
            expect(mapDataType('integer')).toBe('INTEGER');
            expect(mapDataType('int')).toBe('INTEGER');
            expect(mapDataType('bigint')).toBe('INTEGER');
            expect(mapDataType('smallint')).toBe('INTEGER');
            expect(mapDataType('serial')).toBe('INTEGER');
            expect(mapDataType('bigserial')).toBe('INTEGER');
        });

        it('maps floating point types', () => {
            expect(mapDataType('float')).toBe('FLOAT');
            expect(mapDataType('double')).toBe('FLOAT');
            expect(mapDataType('real')).toBe('FLOAT');
            expect(mapDataType('numeric')).toBe('FLOAT');
            expect(mapDataType('decimal')).toBe('FLOAT');
        });

        it('maps boolean types', () => {
            expect(mapDataType('boolean')).toBe('BOOLEAN');
            expect(mapDataType('bool')).toBe('BOOLEAN');
        });

        it('maps date types', () => {
            expect(mapDataType('date')).toBe('DATE');
            expect(mapDataType('timestamp')).toBe('TIMESTAMP');
            expect(mapDataType('datetime')).toBe('TIMESTAMP');
        });

        it('defaults to VARCHAR', () => {
            expect(mapDataType('varchar')).toBe('VARCHAR');
            expect(mapDataType('text')).toBe('VARCHAR');
            expect(mapDataType('char')).toBe('VARCHAR');
            expect(mapDataType('unknown_type')).toBe('VARCHAR');
            expect(mapDataType(null)).toBe('VARCHAR');
            expect(mapDataType(undefined)).toBe('VARCHAR');
            expect(mapDataType('')).toBe('VARCHAR');
        });

        it('handles case-insensitive types', () => {
            expect(mapDataType('INTEGER')).toBe('INTEGER');
            expect(mapDataType('Float')).toBe('FLOAT');
            expect(mapDataType('BOOLEAN')).toBe('BOOLEAN');
        });
    });

    describe('generateQualifiedTableName', () => {
        it('generates fully qualified names', () => {
            expect(generateQualifiedTableName('mydb', 'myschema', 'mytable')).toBe(
                '"mydb"."myschema"."mytable"'
            );
        });

        it('uses default for null database', () => {
            expect(generateQualifiedTableName(null, 'myschema', 'mytable')).toBe(
                '"default"."myschema"."mytable"'
            );
            expect(generateQualifiedTableName(undefined, 'myschema', 'mytable')).toBe(
                '"default"."myschema"."mytable"'
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
            expect(sql).toContain('"id" INTEGER');
            expect(sql).toContain('"name" VARCHAR');
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

            expect(sql).toContain('"id" VARCHAR');
            expect(sql).toContain('"name" VARCHAR');
        });

        it('handles special characters in column names', () => {
            const columns: ColumnMetadata[] = [
                { name: 'user id', ordinalPosition: 0, dataType: 'integer' },
                { name: 'user"name', ordinalPosition: 1, dataType: 'varchar' }
            ];

            const sql = generateCreateTableSQL('db', 'schema', 'users', columns);

            expect(sql).toContain('"user id" INTEGER');
            expect(sql).toContain('"user""name" VARCHAR');
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

            expect(sql).toContain('CREATE TABLE "default"."public"."users"');
        });
    });
});
