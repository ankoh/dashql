#include "dashql/analyzer/stmt/load_stmt.h"

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

LoadStatement::LoadStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast)
    : instance_(instance), statement_id_(statement_id), ast_(ast) {}

static std::regex PARQUET_EXT{".*\\.zip$"};

static std::unordered_map<std::string_view, sx::LoadMethodType> LOAD_METHODS{
    {"csv", sx::LoadMethodType::CSV},
    {"parquet", sx::LoadMethodType::PARQUET},
    {"json", sx::LoadMethodType::JSON},
};

std::unique_ptr<LoadStatement> LoadStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_LOAD)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_DATA_SOURCE, SX_DATA_SOURCE),
            sxm::Attribute(sx::AttributeKey::DASHQL_LOAD_METHOD, SX_METHOD)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE),
        });
    // clang-format on

    // Match root
    auto ast = schema.Match(instance, stmt->root_node, 3);
    auto xtr = std::make_unique<LoadStatement>(instance, stmt_id, std::move(ast));

    // Read attributes
    if (xtr->ast_[SX_METHOD]) {
        xtr->load_method_ = xtr->ast_[SX_METHOD].DataAsEnum<sx::LoadMethodType>();
    }

    // Read data source
    std::optional<std::string_view> indirection;
    if (auto src = xtr->ast_[SX_DATA_SOURCE]; src) {
        xtr->data_source_ = parser::QualifiedNameView::ReadFrom(program.nodes, instance.program_text(), src.node_id)
                                .WithDefaultSchema(instance.script_options().global_namespace);

        // Try to infer load method from index value if possible.
        // E.g.: LOAD foo FROM somezip['archive.parquet'];
        if (!xtr->ast_[SX_METHOD] && !xtr->data_source_.index_value.empty()) {
            auto idx = trimview(xtr->data_source_.index_value, isNoQuote);
            auto ext = idx.substr(idx.find_last_of(".") + 1);
            auto iter = LOAD_METHODS.find(ext);
            if (iter != LOAD_METHODS.end()) {
                xtr->load_method_ = iter->second;
            }
        }
    }
    return xtr;
}

/// Print the options as json
void LoadStatement::PrintOptionsAsJSON(std::ostream& out, bool pretty) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];
    json::DocumentWriter writer{instance_, stmt->root_node, ast_};
    writer.writeAsJSON(out, pretty, true);
}

/// Pack the load statement
fb::Offset<ana::LoadStatement> LoadStatement::Pack(fb::FlatBufferBuilder& builder) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];

    // Add data source
    auto data_qualified = builder.CreateString(data_source_.WithoutIndex().ToString());
    std::optional<fb::Offset<fb::String>> data_index;
    if (!data_source_.index_value.empty()) {
        data_index = builder.CreateString(trimview(data_source_.index_value, isNoQuote));
    }

    // Print the options
    flatbuffers::Offset<flatbuffers::String> options;
    {
        std::stringstream out;
        PrintOptionsAsJSON(out, false);
        options = builder.CreateString(out.str());
    }

    // Build load statement
    proto::analyzer::LoadStatementBuilder eb{builder};
    eb.add_statement_id(statement_id_);
    eb.add_data_source(data_qualified);
    if (data_index) eb.add_data_source_index(*data_index);
    eb.add_method(load_method_);
    eb.add_options(options);
    return eb.Finish();
}

}  // namespace dashql
