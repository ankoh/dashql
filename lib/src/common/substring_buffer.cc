#include "dashql/common/substring_buffer.h"

#include <iostream>

namespace dashql {

// Constructor
SubstringBuffer::SubstringBuffer(std::string_view text)
    : substring_loc_(proto::syntax::Location(0, text.size())), buffer_(text), lengthen_(), shorten_() {}
// Constructor
SubstringBuffer::SubstringBuffer(std::string_view text, proto::syntax::Location loc)
    : substring_loc_(loc), buffer_(text.substr(loc.offset(), loc.length())), lengthen_(), shorten_() {}

// Patch a location
proto::syntax::Location SubstringBuffer::CheckBounds(proto::syntax::Location loc) const {
    auto begin =
        std::min(std::max(loc.offset(), substring_loc_.offset()), substring_loc_.offset() + substring_loc_.length());
    auto end = std::min(std::max(loc.offset() + loc.length(), substring_loc_.offset()),
                        substring_loc_.offset() + substring_loc_.length());
    return {begin, end - begin};
}

// Patch a location
proto::syntax::Location SubstringBuffer::ApplyPatches(proto::syntax::Location loc) const {
    auto begin = loc.offset();
    auto end = loc.offset() + loc.length();
    auto a = loc.offset();
    auto b = end;
    for (auto& [ofs, adjust] : lengthen_) {
        a += (begin >= ofs) * adjust;
        b += (end >= ofs) * adjust;
    }
    for (auto& [ofs, adjust] : shorten_) {
        a -= (begin >= ofs) * adjust;
        b -= (end >= ofs) * adjust;
    }
    return {a, b - a};
}

/// Intersect with the buffer range?
bool SubstringBuffer::Intersects(proto::syntax::Location loc) const { return CheckBounds(loc).length() > 0; }

// Replace a substring
void SubstringBuffer::Replace(proto::syntax::Location loc, std::string_view value) {
    auto patched_loc = ApplyPatches(CheckBounds(loc));
    buffer_.replace(patched_loc.offset() - substring_loc_.offset(), patched_loc.length(), value);
    if (value.length() < patched_loc.length()) {
        auto diff = patched_loc.length() - value.length();
        shorten_.push_back({patched_loc.offset() + diff, diff});
    } else if (value.length() > patched_loc.length()) {
        auto diff = value.length() - patched_loc.length();
        lengthen_.push_back({
            patched_loc.offset() + patched_loc.length(),
            diff,
        });
    }
}

}  // namespace dashql
