import * as fs from 'fs';
import { fileURLToPath } from 'node:url';

const configPath = new URL('../static/config.json', import.meta.url);

describe('App config', () => {
    it('can be parsed', async () => {
        const file = await fs.promises.readFile(fileURLToPath(configPath), 'utf-8');
        expect(() => JSON.parse(file)).not.toThrow();
    });
});
