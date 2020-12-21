import { platform } from '../../src/index_node';
import { mockHTTP, HTTPMock, encodeTextBody, decodeTextBody } from '../mocks/http_mock';
import { AxiosError } from 'axios';

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
        const http = new platform.HTTPManager();
        await http.init();

        // Initial request
        httpMock.onAny().reply(200, encodeTextBody("foo"));
        let r = await http.request({
            url: "http://localhost/test1",
            method: "GET",
        });
        expect(decodeTextBody(new Uint8Array(r.response.data))).toBe("foo");

        // A different request must fail
        httpMock.reset();
        httpMock.onAny().reply(404);
        expect(async () =>
            await http.request({
                url: "http://localhost/test2",
                method: "GET",
            })
        ).rejects.toThrow(new Error("Request failed with status code 404"));

        // // Make sure an identical request hits the cache
        // httpMock.reset();
        // httpMock.onAny().reply(404);
        // r = await http.request({
        //     url: "http://localhost/test1",
        //     method: "GET",
        // });
        // expect(decodeTextBody(new Uint8Array(r.response.data))).toBe("foo");
    });
});
