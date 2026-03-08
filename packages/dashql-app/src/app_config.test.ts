import * as fs from 'fs';
import * as path from 'node:path';

describe('App config', () => {
    it('can be parsed', async () => {
        const configPath = path.join(process.cwd(), 'static/config.json');
        const file = await fs.promises.readFile(configPath, 'utf-8');
        expect(() => JSON.parse(file)).not.toThrow();
    });
});
