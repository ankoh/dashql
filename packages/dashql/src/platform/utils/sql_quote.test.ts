import { describe, expect, it } from 'vitest';

import { quoteIdentifier } from './sql_quote.js';

describe('SQL quoting', () => {
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
});
