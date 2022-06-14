// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_LOCATION_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_LOCATION_H_

#include <charconv>

#include "dashql/proto_generated.h"

namespace dashql {
namespace parser {

namespace sx = proto;

inline proto::Location Loc(std::initializer_list<proto::Location> locs) {
    assert(locs.size() > 1);
    uint32_t begin = std::numeric_limits<uint32_t>::max();
    uint32_t end = 0;
    for (auto& loc : locs) {
        begin = std::min(begin, loc.offset());
        end = std::max(end, loc.offset() + loc.length());
    }
    return proto::Location(begin, end - begin);
}

inline proto::Location LocAfter(proto::Location loc) { return proto::Location(loc.offset() + loc.length(), 0); }

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_GRAMMAR_LOCATION_H_
