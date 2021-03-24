import * as webdb from '../../src/';

const testRows = 3000;

export function testBindings(db: () => webdb.WebDBBindings) {
    var conn: webdb.WebDBConnection;

    beforeEach(() => {
        conn = db().connect();
    });

    afterEach(() => {
        conn.disconnect();
    });

    describe('WebDBBindings', () => {
        describe('error handling', () => {
            it('INVALID SQL', async () => {
                let error: Error | null = null;
                try {
                    conn.sendQuery('INVALID');
                } catch (e) {
                    error = e;
                }
                expect(error).not.toBe(null);
            });
        });
    });
}
