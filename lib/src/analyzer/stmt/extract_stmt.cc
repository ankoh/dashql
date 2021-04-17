#include "dashql/analyzer/stmt/extract_stmt.h"

#include "dashql/analyzer/program_instance.h"
#include "dashql/proto_generated.h"

constexpr size_t SX_DATA_SOURCE = 0;
constexpr size_t SX_DATA_INDIRECTION = 2;
constexpr size_t SX_METHOD = 1;
namespace fb = flatbuffers;
namespace ana = dashql::proto::analyzer;

namespace dashql {

std::unique_ptr<ExtractStatement> ExtractStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_EXTRACT)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_EXTRACT_DATA)
                .MatchArray()
                .MatchChildren({
                    sxm::Element(SX_DATA_SOURCE)
                        .MatchString(),
                    sxm::Element()
                        .MatchObject(sx::NodeType::OBJECT_SQL_INDIRECTION)
                        .MatchChildren({
                            sxm::Attribute(sx::AttributeKey::SQL_INDIRECTION_INDEX, SX_DATA_INDIRECTION)
                                .MatchString()
                        }),
                }),
            sxm::Attribute(sx::AttributeKey::DASHQL_EXTRACT_METHOD, SX_METHOD)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_EXTRACT_METHOD_TYPE),
        });
    // clang-format on

    // Match root
    auto ast = schema.Match(instance, stmt->root_node, 3);

    // Get indirections
    std::optional<std::string_view> indirection;
    if (ast[SX_DATA_INDIRECTION]) {
        auto& node = program.nodes[ast[SX_DATA_INDIRECTION].node_id];
        indirection = instance.TextAt(node.location());
    }

    auto extract = std::make_unique<ExtractStatement>(instance, stmt_id, std::move(ast));
    return extract;
}

/// Pack the extract statement
fb::Offset<ana::ExtractStatement> ExtractStatement::Pack(fb::FlatBufferBuilder& builder) const {
    proto::analyzer::ExtractStatementBuilder eb{builder};
    return eb.Finish();
}

}  // namespace dashql
