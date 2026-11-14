import { quoteIdentifier, quoteLiteral } from './quote.js';

describe('quoteIdentifier', () => {
    it('quotes a name in double quotes', () => {
        expect(quoteIdentifier('sales')).toBe('"sales"');
        expect(quoteIdentifier('sales.hyper')).toBe('"sales.hyper"');
    });

    it('doubles the double quotes in a name', () => {
        expect(quoteIdentifier('a"b')).toBe('"a""b"');
    });
});

describe('quoteLiteral', () => {
    it('quotes a text in single quotes and doubles the single quotes in it', () => {
        expect(quoteLiteral('x')).toBe("'x'");
        expect(quoteLiteral("it's")).toBe("'it''s'");
        expect(quoteLiteral('')).toBe("''");
    });
});
