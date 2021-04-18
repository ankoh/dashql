#include "dashql/analyzer/stmt/load_stmt.h"

#include <regex>

#include "dashql/analyzer/program_instance.h"
#include "dashql/common/string.h"
#include "dashql/proto_generated.h"

constexpr size_t SX_LOAD_METHOD = 0;
constexpr size_t SX_LOAD_FROM_URI = 1;
namespace fb = flatbuffers;
namespace ana = dashql::proto::analyzer;

namespace dashql {

LoadStatement::LoadStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast)
    : instance_(instance), statement_id_(statement_id), ast_(ast) {}

static std::regex LOAD_URI_HTTP{"^https?://.*"};

std::unique_ptr<LoadStatement> LoadStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
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

    // Get load method
    auto method = sx::LoadMethodType::NONE;
    if (auto m = ast[SX_LOAD_METHOD]; m) {
        method = m.DataAsEnum<sx::LoadMethodType>();
    }
    if (auto m = ast[SX_LOAD_FROM_URI]; m) {
        auto node_id = ast[SX_LOAD_FROM_URI].node_id;
        auto& node = program.nodes[node_id];

        // Match method prefixes
        auto uri = std::string{trimview(instance.TextAt(node.location()), isNoQuote)};
        if (std::regex_match(uri, LOAD_URI_HTTP)) {
            method = sx::LoadMethodType::HTTP;
        }
    }

    auto load = std::make_unique<LoadStatement>(instance, stmt_id, std::move(ast));
    return load;
}

/// Pack the extract statement
fb::Offset<ana::LoadStatement> LoadStatement::Pack(fb::FlatBufferBuilder& builder) const {
    proto::analyzer::LoadStatementBuilder eb{builder};
    return eb.Finish();
}

}  // namespace dashql
