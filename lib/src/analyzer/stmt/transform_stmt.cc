#include "dashql/analyzer/stmt/transform_stmt.h"

#include <regex>

#include "dashql/analyzer/json_patch.h"
#include "dashql/analyzer/json_writer.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/common/string.h"
#include "dashql/parser/qualified_name.h"
#include "dashql/proto_generated.h"
#include "rapidjson/ostreamwrapper.h"
#include "rapidjson/prettywriter.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

constexpr size_t SX_DATA_SOURCE = 0;
constexpr size_t SX_METHOD = 1;
namespace fb = flatbuffers;
namespace ana = dashql::proto::analyzer;

namespace dashql {

TransformStatement::TransformStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast)
    : instance_(instance), statement_id_(statement_id), ast_(ast) {}

static std::regex PARQUET_EXT{".*\\.zip$"};

static std::unordered_map<std::string_view, sx::TransformMethodType> LOAD_METHODS{
    {"csv", sx::TransformMethodType::JMESPATH},
};

std::unique_ptr<TransformStatement> TransformStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_TRANSFORM)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_DATA_SOURCE, SX_DATA_SOURCE),
            sxm::Attribute(sx::AttributeKey::DASHQL_TRANSFORM_METHOD, SX_METHOD)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_TRANSFORM_METHOD_TYPE),
        });
    // clang-format on

    // Match root
    auto ast = schema.Match(instance, stmt->root_node, 3);
    auto trans = std::make_unique<TransformStatement>(instance, stmt_id, std::move(ast));

    // Read attributes
    if (trans->ast_[SX_METHOD]) {
        trans->method_ = trans->ast_[SX_METHOD].DataAsEnum<sx::TransformMethodType>();
    }

    // Read data source
    std::optional<std::string_view> indirection;
    if (auto src = trans->ast_[SX_DATA_SOURCE]; src) {
        trans->data_source_ = parser::QualifiedNameView::ReadFrom(program.nodes, instance.program_text(), src.node_id)
                                  .WithDefaultSchema(instance.script_options().global_namespace);

        // Try to infer load method from index value if possible.
        // E.g.: LOAD foo FROM somezip['archive.parquet'];
        if (!trans->ast_[SX_METHOD] && !trans->data_source_.index_value.empty()) {
            auto idx = trimview(trans->data_source_.index_value, isNoQuote);
            auto ext = idx.substr(idx.find_last_of(".") + 1);
            auto iter = LOAD_METHODS.find(ext);
            if (iter != LOAD_METHODS.end()) {
                trans->method_ = iter->second;
            }
        }
    }
    return trans;
}

/// Print the options as json
void TransformStatement::PrintExtraAsJSON(std::ostream& out, bool pretty) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];
    json::DocumentWriter writer{instance_, stmt->root_node, ast_};
    writer.writeAsJSON(out, pretty, true);
}

/// Pack the load statement
fb::Offset<ana::TransformStatement> TransformStatement::Pack(fb::FlatBufferBuilder& builder) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];

    // Add data source
    auto data_qualified = builder.CreateString(data_source_.WithoutIndex().ToString());
    std::optional<fb::Offset<fb::String>> data_index;
    if (!data_source_.index_value.empty()) {
        data_index = builder.CreateString(trimview(data_source_.index_value, isNoQuote));
    }

    // Print the options
    flatbuffers::Offset<flatbuffers::String> extra;
    {
        std::stringstream out;
        PrintExtraAsJSON(out, false);
        extra = builder.CreateString(out.str());
    }

    // Build load statement
    proto::analyzer::TransformStatementBuilder eb{builder};
    eb.add_statement_id(statement_id_);
    eb.add_data_source(data_qualified);
    if (data_index) eb.add_data_source_index(*data_index);
    eb.add_method(method_);
    eb.add_extra(extra);
    return eb.Finish();
}

}  // namespace dashql
