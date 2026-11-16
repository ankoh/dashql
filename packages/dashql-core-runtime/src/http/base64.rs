//! Base64 as the browsers encode and decode it, like `btoa` and `atob`.

/// The base64 alphabet
const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encode bytes in base64 with padding, like `btoa`
pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk.first().copied().unwrap_or(0);
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        // Six bits index the 64 symbols
        let symbol = |shift: u32| char::from(BASE64.get(((n >> shift) & 63) as usize).copied().unwrap_or(b'A'));
        out.push(symbol(18));
        out.push(symbol(12));
        out.push(if chunk.len() > 1 { symbol(6) } else { '=' });
        out.push(if chunk.len() > 2 { symbol(0) } else { '=' });
    }
    out
}

/// Decode base64 like `atob`: ASCII whitespace is skipped and the padding is optional. None if the text is no
/// base64.
pub fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let mut symbols: Vec<u8> = text.bytes().filter(|b| !matches!(b, b' ' | b'\t' | b'\n' | b'\x0c' | b'\r')).collect();
    if symbols.len().is_multiple_of(4) {
        // Up to two padding characters at the end
        for _ in 0..2 {
            if symbols.last() == Some(&b'=') {
                symbols.pop();
            }
        }
    }
    if symbols.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(symbols.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for symbol in symbols {
        let value = match symbol {
            b'A'..=b'Z' => symbol - b'A',
            b'a'..=b'z' => symbol - b'a' + 26,
            b'0'..=b'9' => symbol - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}
