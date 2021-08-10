// Copyright (c) 2021 The DashQL Authors

export function estimateUTF16Length(s: string): number {
    // Assuming the String is UTF-16
    let n = 0;
    for (let i = 0, l = s.length; i < l; i++) {
        const hi = s.charCodeAt(i);
        if (hi < 0x0080) {
            // [0x0000, 0x007F]
            n += 1;
        } else if (hi < 0x0800) {
            // [0x0080, 0x07FF]
            n += 2;
        } else if (hi < 0xd800) {
            // [0x0800, 0xD7FF]
            n += 3;
        } else if (hi < 0xdc00) {
            // [0xD800, 0xDBFF]
            const lo = s.charCodeAt(++i);
            if (i < l && lo >= 0xdc00 && lo <= 0xdfff) {
                // Followed by [0xDC00, 0xDFFF]
                n += 4;
            } else {
                // Invalid UTF-16
            }
        } else if (hi < 0xe000) {
            // [0xDC00, 0xDFFF]
            // Invalid UTF-16
        } else {
            // [0xE000, 0xFFFF]
            n += 3;
        }
    }
    return n;
}

export function countLines(s: string): number {
    return (s.match(/\n/g) || '').length + 1;
}

/** Wrapper for TextDecoder to support shared array buffers */
function TextDecoderWrapper(): (input?: BufferSource) => string {
    const decoder = new TextDecoder();
    return (data: any) => {
        if (typeof SharedArrayBuffer !== 'undefined' && data.buffer instanceof SharedArrayBuffer) {
            data = new Uint8Array(data);
        }
        return decoder.decode(data);
    };
}

export const decodeText = TextDecoderWrapper();
