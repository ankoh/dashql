import * as duckdbx from '../src';

export function testBindings() {
    describe('Bindings', () => {
        it('open in memory', async () => {
            await duckdbx.openInMemory();
        });
    });
}
