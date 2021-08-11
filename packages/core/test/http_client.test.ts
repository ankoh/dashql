import { HTTPClient } from '../src/http_client';
import { model } from '../src/index';
import { mockHTTP, HTTPMock, encodeTextBody, decodeTextBody } from './http_mock';

export function testHTTPClient(): void {
    let httpMock: HTTPMock = null;

    afterEach(() => {
        if (httpMock != null) {
            httpMock.reset();
            httpMock = null;
        }
    });

    describe('HTTPClient', () => {
        it('init', () => {});

        it('fetch', async () => {
            const logger = model.Logger.createWired();
            const http = new HTTPClient(logger);

            httpMock = mockHTTP();
            httpMock
                .onGet('http://localhost/file1')
                .reply(200, encodeTextBody('body1'))
                .onGet('http://localhost/file2')
                .reply(404)
                .onGet('http://localhost/file3')
                .reply(200, encodeTextBody('body3'))
                .onGet('http://localhost/file4')
                .reply(200, encodeTextBody('body4'));

            const expectBody = async (url: string, body: string) => {
                const r = await http.request({ url: url });
                expect(decodeTextBody(new Uint8Array(r.response.data))).toBe(body);
            };
            const expect404 = async (url: string) => {
                try {
                    await http.request({ url: url });
                } catch (e) {
                    // check 404?
                    return;
                }
                fail('Request should fail with status code 404');
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

            await expect404('http://localhost/file1');
            await expect404('http://localhost/file2');
            await expect404('http://localhost/file3');
            await expect404('http://localhost/file4');
        });
    });
}
