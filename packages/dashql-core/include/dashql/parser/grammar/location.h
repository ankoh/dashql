#pragma once

#include <iostream>

#include "dashql/buffers/index_generated.h"

namespace dashql {
namespace parser {

inline std::ostream& operator<<(std::ostream& out, const dashql::buffers::parser::SymbolSpan& loc) {
    out << "(" << loc.offset() << "+" << loc.length() << ")";
    return out;
}

inline std::ostream& operator<<(std::ostream& out, const dashql::buffers::parser::TextSpan& loc) {
    out << "[" << loc.offset() << "+" << loc.length() << "]";
    return out;
}

inline buffers::parser::SymbolSpan Loc(std::initializer_list<buffers::parser::SymbolSpan> locs) {
    assert(locs.size() > 1);
    uint32_t begin = std::numeric_limits<uint32_t>::max();
    uint32_t end = 0;
    for (auto& loc : locs) {
        begin = std::min(begin, loc.offset());
        end = std::max(end, loc.offset() + loc.length());
    }
    return buffers::parser::SymbolSpan(begin, end - begin);
}

}  // namespace parser
}  // namespace dashql
