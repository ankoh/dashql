//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PARSER_RPATH_RPATH_SYNTAX_H_
#define INCLUDE_TIGON_PARSER_RPATH_RPATH_SYNTAX_H_

#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>
#include <optional>

namespace tigon {
namespace rpath {

struct ArraySlice {
    std::optional<int32_t> begin;
    std::optional<int32_t> end;
};

struct ArrayIndexes {
    std::vector<int32_t> indexes;
};

struct ChildMember {
    std::string name;
};

struct DescendantMember {
    std::string name;
};

using RPathComponent = std::variant<
    ArrayIndexes,
    ArraySlice,
    ChildMember,
    DescendantMember
>;

/// A record path
struct RPath {
    /// The path components
    std::vector<RPathComponent> components;
};

} // namespace rpath
} // namespace tigon

#endif // INCLUDE_TIGON_PARSER_RPATH_RPATH_SYNTAX_H_

