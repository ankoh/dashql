import { platform } from '../../src/index_node';
import { mockHTTP, HTTPMock, encodeTextBody } from '../mocks/http_mock';

let httpMock: HTTPMock;

beforeEach(() => {
    httpMock = mockHTTP();
});

afterEach(() => {
    httpMock.reset();
});

describe('HTTPManager', () => {
    test('init', () => {});

    test('fetch', async () => {
        httpMock.onAny().reply(200, encodeTextBody("foo"));

        const http = new platform.HTTPManager();
        await http.init();

        await http.request({
            url: "http://localhost/test1",
            method: "GET",
        });
    });
});
