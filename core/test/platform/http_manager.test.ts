import { platform } from '../../src/index_node';

const http = new platform.HTTPManager();

beforeAll(async () => {
    await http.init();
});

describe('HTTPManager', () => {
    test('init', () => {});
});
