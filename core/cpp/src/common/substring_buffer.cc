#include "dashql/common/substring_buffer.h"
#include <iostream>

namespace dashql {

// Constructor
SubstringBuffer::SubstringBuffer(std::string_view text, proto::syntax::Location loc)
    : substring_loc_(loc), buffer_(text.substr(loc.offset(), loc.length())), lengthen_(), shorten_() {}

// Patch a location
proto::syntax::Location SubstringBuffer::Patch(proto::syntax::Location loc) const {
    auto begin = loc.offset();
    auto end = loc.offset() + loc.length();
    auto a = loc.offset();
    auto b = end;
    for (auto& [ofs, adjust]: lengthen_) {
        a += (begin >= ofs) * adjust;
        b += (end >= ofs) * adjust;
    }
    for (auto& [ofs, adjust]: shorten_) {
        a -= (begin >= ofs) * adjust;
        b -= (end >= ofs) * adjust;
    }
    return {a, b - a};
}

// Replace a substring
void SubstringBuffer::Replace(proto::syntax::Location loc, std::string_view value) {
    assert(loc.offset() >= substring_loc_.offset());
    auto patched_loc = Patch(loc);
    buffer_.replace(patched_loc.offset() - substring_loc_.offset(), patched_loc.length(), value);
    if (value.length() < patched_loc.length()) {
        auto diff = patched_loc.length() - value.length();
        shorten_.push_back({
            patched_loc.offset() + diff,
            diff
        });
    } else if (value.length() > patched_loc.length()) {
        auto diff = value.length() - patched_loc.length();
        lengthen_.push_back({
            patched_loc.offset() + patched_loc.length(),
            diff,
        });
    }
}

}
