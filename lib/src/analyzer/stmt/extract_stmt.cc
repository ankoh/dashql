#include "dashql/analyzer/stmt/extract_stmt.h"

#include "dashql/analyzer/json_patch.h"
#include "dashql/analyzer/json_writer.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/common/string.h"
#include "dashql/proto_generated.h"
#include "rapidjson/ostreamwrapper.h"
#include "rapidjson/prettywriter.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

constexpr size_t SX_DATA_SOURCE = 0;
constexpr size_t SX_DATA_INDIRECTION = 2;
constexpr size_t SX_METHOD = 1;
namespace fb = flatbuffers;
namespace ana = dashql::proto::analyzer;

namespace dashql {

ExtractStatement::ExtractStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast)
    : instance_(instance), statement_id_(statement_id), ast_(ast) {}

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
                        .MatchObject(sx::NodeType::OBJECT_SQL_INDIRECTION_INDEX)
                        .MatchChildren({
                            sxm::Attribute(sx::AttributeKey::SQL_INDIRECTION_INDEX_VALUE, SX_DATA_INDIRECTION)
                                .MatchString()
                        }),
                }),
            sxm::Attribute(sx::AttributeKey::DASHQL_EXTRACT_METHOD, SX_METHOD)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_EXTRACT_METHOD_TYPE),
        });
    // clang-format on

    // Match root
    auto ast = schema.Match(instance, stmt->root_node, 3);
    auto xtr = std::make_unique<ExtractStatement>(instance, stmt_id, std::move(ast));

    // Read attributes
    if (xtr->ast_[SX_METHOD]) {
        xtr->extract_method_ = xtr->ast_[SX_METHOD].DataAsEnum<sx::ExtractMethodType>();
    }

    // Get indirections
    std::optional<std::string_view> indirection;
    if (xtr->ast_[SX_DATA_INDIRECTION]) {
        auto& node = program.nodes[xtr->ast_[SX_DATA_INDIRECTION].node_id];
        xtr->indirection_ = trimview(instance.TextAt(node.location()), isNoQuote);
    }

    return xtr;
}

/// Print the options as json
void ExtractStatement::PrintOptionsAsJSON(std::ostream& out, bool pretty) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];
    json::DocumentWriter writer{instance_, stmt->root_node, ast_};
    writer.writeOptionsAsJSON(out, pretty);
}

/// Pack the extract statement
fb::Offset<ana::ExtractStatement> ExtractStatement::Pack(fb::FlatBufferBuilder& builder) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];

    // Create target strings
    // auto target_short = builder.CreateString(stmt->name_short);
    // auto target_qualified = builder.CreateString(stmt->name_qualified);

    // Encode indirection
    std::optional<fb::Offset<fb::String>> indirection;
    if (indirection_) indirection = builder.CreateString(*indirection_);

    // Print the options
    flatbuffers::Offset<flatbuffers::String> options;
    {
        std::stringstream out;
        PrintOptionsAsJSON(out, false);
        options = builder.CreateString(out.str());
    }

    // Build extract statement
    proto::analyzer::ExtractStatementBuilder eb{builder};
    eb.add_statement_id(statement_id_);
    if (indirection) eb.add_target_indirection(*indirection);
    eb.add_method(extract_method_);
    eb.add_options(options);
    return eb.Finish();
}

}  // namespace dashql
