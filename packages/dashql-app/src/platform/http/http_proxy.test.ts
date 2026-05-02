import { applyHttpProxy, HEADER_FORWARD_TO, shouldProxyHost } from './http_proxy.js';

describe('shouldProxyHost', () => {
    it('returns false for empty target list', () => {
        expect(shouldProxyHost('login.salesforce.com', undefined)).toBe(false);
        expect(shouldProxyHost('login.salesforce.com', '')).toBe(false);
        expect(shouldProxyHost('login.salesforce.com', '   ,  ,  ')).toBe(false);
    });
    it('matches exact host', () => {
        expect(shouldProxyHost('login.salesforce.com', 'login.salesforce.com')).toBe(true);
        expect(shouldProxyHost('login.salesforce.com', 'example.com, login.salesforce.com')).toBe(true);
    });
    it('is case-insensitive', () => {
        expect(shouldProxyHost('LOGIN.Salesforce.COM', 'login.salesforce.com')).toBe(true);
    });
    it('does not match on unrelated host', () => {
        expect(shouldProxyHost('login.salesforce.com', 'example.com')).toBe(false);
    });
    it('matches wildcard patterns and the base domain', () => {
        expect(shouldProxyHost('foo.my.salesforce.com', '*.my.salesforce.com')).toBe(true);
        expect(shouldProxyHost('a.b.my.salesforce.com', '*.my.salesforce.com')).toBe(true);
        expect(shouldProxyHost('my.salesforce.com', '*.my.salesforce.com')).toBe(true);
        expect(shouldProxyHost('othermy.salesforce.com', '*.my.salesforce.com')).toBe(false);
    });
    it('trims whitespace around entries', () => {
        expect(shouldProxyHost('example.com', '  example.com  ,  foo.com ')).toBe(true);
    });
});

describe('applyHttpProxy', () => {
    const target = new URL('https://login.salesforce.com/services/oauth2/token?x=1');

    it('passes through when no proxy URL is configured', () => {
        const routed = applyHttpProxy(target, { targetList: 'login.salesforce.com' });
        expect(routed.url).toBe(target);
        expect(routed.extraHeaders).toBeUndefined();
    });
    it('passes through when host is not in the target list', () => {
        const routed = applyHttpProxy(target, { proxyUrl: 'http://127.0.0.1:23333', targetList: 'other.example.com' });
        expect(routed.url).toBe(target);
        expect(routed.extraHeaders).toBeUndefined();
    });
    it('rewrites to proxy origin and emits X-Forward-To on exact match', () => {
        const routed = applyHttpProxy(target, { proxyUrl: 'http://127.0.0.1:23333', targetList: 'login.salesforce.com' });
        expect(routed.url.origin).toBe('http://127.0.0.1:23333');
        expect(routed.url.pathname).toBe('/services/oauth2/token');
        expect(routed.url.search).toBe('?x=1');
        expect(routed.extraHeaders?.[HEADER_FORWARD_TO]).toBe('https://login.salesforce.com');
    });
    it('rewrites on wildcard match', () => {
        const t = new URL('https://org.my.salesforce.com/api/data');
        const routed = applyHttpProxy(t, { proxyUrl: 'http://127.0.0.1:23333', targetList: '*.my.salesforce.com' });
        expect(routed.url.origin).toBe('http://127.0.0.1:23333');
        expect(routed.url.pathname).toBe('/api/data');
        expect(routed.extraHeaders?.[HEADER_FORWARD_TO]).toBe('https://org.my.salesforce.com');
    });
});
