import * as duckdbx from '../src/index.mjs';

export function testBindings() {
    describe('Bindings', () => {
        it('open in memory', async () => {
            await duckdbx.openInMemory();
        });
    });
}
