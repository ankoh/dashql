#include "dashql/parser/qualified_name.h"

#include <sstream>

#include "dashql/analyzer/syntax_matcher.h"

namespace dashql {
namespace parser {

constexpr size_t SX_NAME_RELATION = 0;
constexpr size_t SX_NAME_SCHEMA = 1;
constexpr size_t SX_NAME_CATALOG = 2;
constexpr size_t SX_INDIRECTION_INDEX = 3;

std::string QualifiedNameView::ToString() const {
    std::stringstream out;
    if (!catalog.empty()) out << catalog << ".";
    if (!schema.empty()) out << schema << ".";
    out << relation;
    if (!index_value.empty()) out << "[" << index_value << "]";
    return out.str();
}

std::string QualifiedNameView::ToPrettyString() const {
    std::stringstream out;
    out << relation;
    return out.str();
}

QualifiedNameView QualifiedNameView::ReadFrom(nonstd::span<proto::syntax::Node> nodes, std::string_view text,
                                              size_t root_id) {
    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_SQL_QUALIFIED_NAME)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::SQL_QUALIFIED_NAME_CATALOG, SX_NAME_CATALOG)
                .MatchString(),
            sxm::Attribute(sx::AttributeKey::SQL_QUALIFIED_NAME_INDEX)
                .MatchObject(sx::NodeType::OBJECT_SQL_INDIRECTION_INDEX)
                .MatchChildren({
                    sxm::Attribute(sx::AttributeKey::SQL_INDIRECTION_INDEX_VALUE, SX_INDIRECTION_INDEX)
                        .MatchString()
                }),
            sxm::Attribute(sx::AttributeKey::SQL_QUALIFIED_NAME_RELATION, SX_NAME_RELATION)
                .MatchString(),
            sxm::Attribute(sx::AttributeKey::SQL_QUALIFIED_NAME_SCHEMA, SX_NAME_SCHEMA)
                .MatchString(),
        });
    // clang-format on
    auto ast = schema.Match(nodes, text, root_id, 4);
    QualifiedNameView view = {
        .catalog = {},
        .schema = {},
        .relation = {},
        .index_value = {},
    };
    auto textAt = [&](size_t node_id) {
        auto loc = nodes[node_id].location();
        return std::string_view{text}.substr(loc.offset(), loc.length());
    };
    if (auto m = ast[SX_NAME_CATALOG]; m) view.catalog = textAt(m.node_id);
    if (auto m = ast[SX_NAME_SCHEMA]; m) view.schema = textAt(m.node_id);
    if (auto m = ast[SX_NAME_RELATION]; m) view.relation = textAt(m.node_id);
    if (auto m = ast[SX_INDIRECTION_INDEX]; m) view.index_value = textAt(m.node_id);
    return view;
}

}  // namespace parser
}  // namespace dashql
