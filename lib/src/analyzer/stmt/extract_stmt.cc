#include "dashql/analyzer/stmt/extract_stmt.h"

#include "dashql/analyzer/program_instance.h"

constexpr size_t SX_LOAD_METHOD = 0;
constexpr size_t SX_LOAD_FROM_URI = 1;

namespace dashql {

std::unique_ptr<ExtractStatement> ExtractStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_LOAD)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_LOAD_METHOD, SX_LOAD_METHOD)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_LOAD_FROM_URI, SX_LOAD_FROM_URI)
                .MatchString(),
        });
    // clang-format on

    // Match root
    auto ast = schema.Match(instance, stmt->root_node, 2);

    auto method_node_id = ast[SX_LOAD_METHOD].node_id;
    auto& method_node = program.nodes[method_node_id];
    auto from_uri_node_id = ast[SX_LOAD_FROM_URI].node_id;
    auto& from_uri_node = program.nodes[from_uri_node_id];

    auto extract = std::make_unique<ExtractStatement>(instance, stmt_id, std::move(ast));
    return extract;
}

}  // namespace dashql
