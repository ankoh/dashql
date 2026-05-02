export const HEADER_FORWARD_TO = "X-Forward-To";

export interface HttpProxyConfig {
    proxyUrl?: string;
    targetList?: string;
}

export interface RoutedRequest {
    url: URL;
    extraHeaders?: Record<string, string>;
}

function parsePatterns(list: string | undefined): string[] {
    if (!list) return [];
    return list.split(',').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
}

function hostMatchesPattern(host: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1);
        const base = pattern.slice(2);
        return host === base || host.endsWith(suffix);
    }
    return host === pattern;
}

export function shouldProxyHost(host: string, targetList: string | undefined): boolean {
    const h = host.toLowerCase();
    const patterns = parsePatterns(targetList);
    for (const p of patterns) {
        if (hostMatchesPattern(h, p)) return true;
    }
    return false;
}

export function applyHttpProxy(target: URL, cfg: HttpProxyConfig): RoutedRequest {
    if (!cfg.proxyUrl || !shouldProxyHost(target.hostname, cfg.targetList)) {
        return { url: target };
    }
    const proxy = new URL(cfg.proxyUrl);
    proxy.pathname = target.pathname;
    proxy.search = target.search;
    return {
        url: proxy,
        extraHeaders: { [HEADER_FORWARD_TO]: `${target.protocol}//${target.host}` },
    };
}

export class HttpProxyConfigHolder {
    private cfg: HttpProxyConfig = {};
    set(next: HttpProxyConfig): void {
        this.cfg = { proxyUrl: next.proxyUrl, targetList: next.targetList };
    }
    get(): HttpProxyConfig {
        return this.cfg;
    }
}
