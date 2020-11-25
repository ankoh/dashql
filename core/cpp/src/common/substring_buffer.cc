#include "dashql/common/substring_buffer.h"
#include <iostream>

namespace dashql {

// Constructor
SubstringBuffer::SubstringBuffer(std::string_view text, proto::syntax::Location loc)
    : buffer_(text.substr(loc.offset(), loc.length())), location_(loc), lengthen_(), shorten_() {}

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
void SubstringBuffer::Replace(proto::syntax::Location global_loc, std::string_view value) {
    assert(global_loc.offset() >= location_.offset());
    auto loc = Patch(global_loc);
    buffer_.replace(loc.offset(), loc.length(), value);
    if (value.length() < loc.length()) {
        auto diff = loc.length() - value.length();
        shorten_.push_back({
            loc.offset() + diff,
            diff
        });
    } else if (value.length() > loc.length()) {
        auto diff = value.length() - loc.length();
        lengthen_.push_back({
            loc.offset() + loc.length(),
            diff,
        });
    }
}

}
