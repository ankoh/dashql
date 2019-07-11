export function formatDurationMS(totalMS: number): string {
    const m = Math.floor(totalMS / 1000 / 60);
    const s = Math.floor((totalMS - m) / 1000);
    const ms = Math.floor(totalMS - m - s);
    const mS = ('00' + m).slice(-2);
    const sS = ('00' + s).slice(-2);
    const msS = ('000' + ms).slice(-3);
    return `${mS}:${sS}.${msS}`;
}
