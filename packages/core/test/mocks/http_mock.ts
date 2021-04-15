import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

export type HTTPMock = MockAdapter;

export function mockHTTP(): HTTPMock {
    return new MockAdapter(axios);
}

export function encodeTextBody(body: string): ArrayBuffer {
    const encoder = new TextEncoder();
    return encoder.encode(body).buffer;
}

export function decodeTextBody(body: ArrayBuffer): string {
    const decoder = new TextDecoder();
    return decoder.decode(body);
}
