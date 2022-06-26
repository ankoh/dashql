import duckdbx from '../dist/duckdbx.node';

export async function openInMemory() {
    await duckdbx.openInMemory();
}
