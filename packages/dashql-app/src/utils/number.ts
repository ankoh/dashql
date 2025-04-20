export function tryParseInt(text: string): number | null {
    try {
        return Number.parseInt(text);
    } catch (_: any) {
        return null;
    }
}
