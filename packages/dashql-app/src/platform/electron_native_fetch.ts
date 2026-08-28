export async function nativeProxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const bridge = globalThis.dashqlElectron;
    if (bridge === undefined) return await fetch(request);

    const headers: Array<[string, string]> = [];
    request.headers.forEach((value, name) => headers.push([name, value]));
    const response = await bridge.nativeProxyRequest({
        body: new Uint8Array(await request.arrayBuffer()),
        headers,
        method: request.method,
        url: request.url,
    }) as {body: Uint8Array; headers: Array<[string, string]>; status: number; statusText: string};
    return new Response(new Uint8Array(response.body), {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
    });
}
