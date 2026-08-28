export const MAX_DEEP_LINK_DATA_LENGTH = 64 * 1024;

export function parseDeepLink(link: string): string | null {
    if (link.length > MAX_DEEP_LINK_DATA_LENGTH * 3 || !link.startsWith("dashql://")) return null;

    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return null;
    }
    if (url.protocol !== "dashql:" || url.hostname !== "localhost" || url.username !== "" ||
        url.password !== "" || url.port !== "" || (url.pathname !== "" && url.pathname !== "/") ||
        url.hash !== "") {
        return null;
    }

    const parameters = [...url.searchParams.entries()];
    if (parameters.length !== 1 || parameters[0]?.[0] !== "data") return null;
    const data = parameters[0][1];
    return data.length > 0 && data.length <= MAX_DEEP_LINK_DATA_LENGTH ? data : null;
}

export function parseDeepLinksFromCommandLine(commandLine: readonly string[]): string[] {
    const links: string[] = [];
    for (const argument of commandLine) {
        const data = parseDeepLink(argument);
        if (data !== null) links.push(data);
    }
    return links;
}

export class DeepLinkQueue {
    private readonly pending: string[] = [];
    private receiver: ((data: string) => void) | null = null;

    push(data: string): void {
        if (this.receiver === null) this.pending.push(data);
        else this.receiver(data);
    }

    attach(receiver: (data: string) => void): string[] {
        this.receiver = receiver;
        return this.pending.splice(0);
    }

    detach(): void {
        this.receiver = null;
    }
}
