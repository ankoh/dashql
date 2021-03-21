import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

export type HTTPMock = MockAdapter;

export function mockHTTP(): HTTPMock {
    return new MockAdapter(axios);
}

export function encodeTextBody(body: string) {
    var encoder = new TextEncoder();
    return encoder.encode(body).buffer;
}

export function decodeTextBody(body: ArrayBuffer) {
    var decoder = new TextDecoder();
    return decoder.decode(body);
}
