function flatten(value: any) {
    let buffer = '';
    if (typeof value === 'string' || typeof value === 'number') {
        buffer += value;
    } else if (typeof value === 'object') {
        if (Array.isArray(value)) {
            for (let k = 0; k < value.length; k++) {
                if (value[k]) {
                    const y = flatten(value[k]);
                    if (y) {
                        buffer && (buffer += ' ');
                        buffer += y;
                    }
                }
            }
        } else {
            for (const k in value) {
                if (value[k]) {
                    buffer && (buffer += ' ');
                    buffer += k;
                }
            }
        }
    }
    return buffer;
}

export function clsx(...args: any[]) {
    let buffer = '';
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        if (arg) {
            const x = flatten(arg);
            if (x) {
                buffer && (buffer += ' ');
                buffer += x;
            }
        }
    }
    return buffer;
}
