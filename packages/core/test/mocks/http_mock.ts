import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

export type HTTPMock = MockAdapter;

export function mockHTTP(): HTTPMock {
    return new MockAdapter(axios);
}

export function encodeTextBody(body: string) {
    const encoder = new TextEncoder();
    return encoder.encode(body).buffer;
}

export function decodeTextBody(body: ArrayBuffer) {
    const decoder = new TextDecoder();
    return decoder.decode(body);
}
