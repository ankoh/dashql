import { beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import { platform, model } from '../../src/index_node';
import { mockHTTP, HTTPMock, encodeTextBody, decodeTextBody } from '../mocks/http_mock';

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
        const store = model.createStore();
        const http = new platform.HTTPManager(store, 2);
        await http.init();

        httpMock
            .onGet('http://localhost/file1')
            .reply(200, encodeTextBody('body1'))
            .onGet('http://localhost/file2')
            .reply(404)
            .onGet('http://localhost/file3')
            .reply(200, encodeTextBody('body3'))
            .onGet('http://localhost/file4')
            .reply(200, encodeTextBody('body4'));

        let expectBody = async (url: string, body: string) => {
            let r = await http.request({ url: url });
            expect(decodeTextBody(new Uint8Array(r.response.data))).toBe(body);
        };
        let expect404 = async (url: string) => {
            expect(http.request({ url: url })).rejects.toThrow(new Error('Request failed with status code 404'));
        };

        await expectBody('http://localhost/file1', 'body1');
        await expect404('http://localhost/file2');
        await expectBody('http://localhost/file3', 'body3');
        await expectBody('http://localhost/file4', 'body4');
        await expectBody('http://localhost/file3', 'body3');
        await expectBody('http://localhost/file1', 'body1');
        await expectBody('http://localhost/file3', 'body3');
        await expectBody('http://localhost/file4', 'body4');

        // Test cache hits
        httpMock.reset();
        httpMock.onAny().reply(404);

        await expectBody('http://localhost/file3', 'body3');
        await expectBody('http://localhost/file4', 'body4');
        await expect404('http://localhost/file1');
        await expect404('http://localhost/file2');
    });
});
