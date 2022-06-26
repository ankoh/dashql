import duckdbx from '../dist/index.node';

export async function openInMemory() {
    await duckdbx.openInMemory();
}
