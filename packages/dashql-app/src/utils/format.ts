export enum ByteFormat {
    SI = 0,
    IEC = 1,
}

export function formatBytes(value: number, format: ByteFormat = ByteFormat.SI): string {
    const [multiple, k, suffix] = format === ByteFormat.SI ? [1000, 'k', 'B'] : [1024, 'K', 'iB'];
    const exp = (Math.log(value) / Math.log(multiple)) | 0;
    const size = Number((value / Math.pow(multiple, exp)).toFixed(2));
    return `${size} ${exp ? `${k}MGTPEZY`[exp - 1] + suffix : `byte${size !== 1 ? 's' : ''}`}`;
}

export function formatThousands(value: number): string {
    const [multiple, k] = [1000, 'k'];
    const exp = (Math.log(value) / Math.log(multiple)) | 0;
    const size = Number((value / Math.pow(multiple, exp)).toFixed(2));
    return size + (exp ? ` ${`${k}MGTPEZY`[exp - 1]}` : '');
}

export function formatNanoseconds(value: number): string {
    const suffix = 'ns';
    if (value >= 1000 * 1000 * 1000) {
        value /= 1000 * 1000;
        return `${value.toFixed(1)} s`;
    }
    if (value >= 1000 * 1000) {
        value /= 1000 * 1000;
        return `${value.toFixed(2)} ms`;
    }
    if (value >= 1000) {
        value /= 1000;
        return `${value.toFixed(0)} us`;
    }
    return `${value.toFixed(1)} ${suffix}`;
}

export function formatMilliseconds(value: number): string {
    const suffix = 'ms';
    if (value >= 1000) {
        value /= 1000;
        return `${value.toFixed(2)} s`;
    }
    return `${value.toFixed(0)} ${suffix}`;
}

export function formatHHMMSS(secs: number) {
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs - (hours * 3600)) / 60);
    const seconds = Math.floor(secs - (hours * 3600) - (minutes * 60));
    const hh = hours < 10 ? `0${hours}` : hours.toString();
    const mm = minutes < 10 ? `0${minutes}` : minutes.toString();
    const ss = seconds < 10 ? `0${seconds}` : seconds.toString();
    return `${hh}:${mm}:${ss}`;
}

const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 24 * 60 * 60 * 1000 * 365],
    ['month', (24 * 60 * 60 * 1000 * 365) / 12],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
    ['second', 1000],
];

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatTimeDifference(to: Date, from: Date = new Date()): string {
    const elapsed = to.getTime() - from.getTime();
    for (const [unitName, unitInMs] of TIME_UNITS) {
        if (Math.abs(elapsed) > unitInMs || unitName == 'second') {
            return rtf.format(Math.round(elapsed / unitInMs), unitName);
        }
    }
    return '';
}

export function quoteIfAnyUpper(text: string) {
    return /[A-Z]/.test(text) ? `"${text}"` : text;
}

