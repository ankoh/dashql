#pragma once

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <span>
#include <stdexcept>

#include "utf8proc/utf8proc.hpp"

// Codepoint boundary in Rust:
// https://github.com/rust-lang/rust/blob/master/library/core/src/num/mod.rs#L1016

namespace dashql::utf8 {

/// Checks if a byte is a UTF8 codepoint boundary.
constexpr bool isCodepointBoundary(std::byte b) {
    auto v = static_cast<uint8_t>(b);
    return v < 128 || v >= 192;
}
/// Checks if a byte is a UTF8 codepoint boundary
constexpr bool isCodepointBoundary(std::span<const std::byte> buffer, size_t pos) {
    if (pos == 0 || pos == buffer.size()) {
        return true;
    } else if (pos > buffer.size()) {
        return false;
    } else {
        return isCodepointBoundary(buffer[pos]);
    }
}
/// Find the previous codepoint boundary
constexpr size_t prevCodepoint(std::span<const std::byte> buffer, size_t pos) {
    assert(pos <= buffer.size());
    for (; pos > 0 && !isCodepointBoundary(buffer[pos]); --pos);
    return pos;
}
/// Find the next codepoint boundary
constexpr size_t nextCodepoint(std::span<const std::byte> buffer, size_t pos) {
    assert(pos <= buffer.size());
    for (; pos < buffer.size() && !isCodepointBoundary(buffer[pos]); ++pos);
    return pos;
}
/// Find the nearest codepoint boundary
constexpr size_t findNearestCodepoint(std::span<const std::byte> buffer, size_t pos) {
    assert(pos <= buffer.size());
    auto prev = prevCodepoint(buffer, pos);
    auto next = nextCodepoint(buffer, pos);
    return ((pos - prev) <= (next - pos)) ? prev : next;
}
/// Find a codepoint boundary, not necessarily the nearest
constexpr size_t findCodepoint(std::span<const std::byte> buffer, size_t pos, bool bias_left = true) {
    assert(pos <= buffer.size());
    auto prev = prevCodepoint(buffer, pos);
    auto next = nextCodepoint(buffer, pos);
    if (bias_left) {
        return (prev > 0) ? prev : next;
    } else {
        return (next < buffer.size()) ? next : prev;
    }
}
/// Find the byte index of a codepoint index.
inline static size_t codepointToByteIdx(std::span<const std::byte> buffer, size_t char_idx) {
    size_t byte_idx = 0;
    for (size_t i = 0; i < char_idx; ++i) {
        if (byte_idx >= buffer.size()) {
            throw std::out_of_range{"UTF-8 codepoint index exceeds buffer"};
        }
        int n = 0;
        utf8proc_codepoint(reinterpret_cast<const char*>(buffer.data() + byte_idx), n);
        if (n <= 0 || static_cast<size_t>(n) > buffer.size() - byte_idx) {
            throw std::invalid_argument{"invalid UTF-8 while resolving codepoint index"};
        }
        byte_idx += static_cast<size_t>(n);
    }
    return byte_idx;
}

}  // namespace dashql::utf8
