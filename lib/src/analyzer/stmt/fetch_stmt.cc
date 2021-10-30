#include "dashql/analyzer/stmt/fetch_stmt.h"

#include <regex>

#include "dashql/analyzer/json_patch.h"
#include "dashql/analyzer/json_writer.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/common/string.h"
#include "dashql/proto_generated.h"

constexpr size_t SX_FETCH_METHOD = 0;
constexpr size_t SX_FETCH_FROM_URI = 1;
constexpr size_t SX_FETCH_URL_OPTION = 2;
namespace fb = flatbuffers;
namespace ana = dashql::proto::analyzer;

namespace dashql {

FetchStatement::FetchStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast)
    : instance_(instance), statement_id_(statement_id), ast_(ast) {}

static std::regex HTTP_PREFIX{"^https?://.*"};
static std::regex ZIP_EXT{".*\\.zip$"};

std::unique_ptr<FetchStatement> FetchStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_FETCH)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_FETCH_FROM_URI, SX_FETCH_FROM_URI)
                .MatchString(),
            sxm::Attribute(sx::AttributeKey::DASHQL_FETCH_METHOD, SX_FETCH_METHOD)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_FETCH_METHOD_TYPE),
            sxm::Attribute(sx::AttributeKey::DSON_URL, SX_FETCH_URL_OPTION)
        });
    // clang-format on

    // Match root
    auto ast = schema.Match(instance, stmt->root_node, 3);
    auto fetch = std::make_unique<FetchStatement>(instance, stmt_id, std::move(ast));

    // Helper to report a redundant option
    auto optionIsRedundant = [&](size_t match_id, std::string_view name) {
        if (auto m = fetch->ast_[match_id]; m) {
            instance.AddLinterMessage(LinterMessageCode::KEY_REDUNDANT, m.node_id)
                << "option '" << name << "' is redundant";
        }
    };

    // Get fetch method
    fetch->method_ = sx::FetchMethodType::NONE;
    if (auto m = fetch->ast_[SX_FETCH_METHOD]; m) {
        fetch->method_ = m.DataAsEnum<sx::FetchMethodType>();

        if (auto url = fetch->ast_[SX_FETCH_URL_OPTION]; url) {
            fetch->url_ = trimview(instance.TextAt(program.nodes[url.node_id].location()), isNoQuote);
        } else {
            instance.AddLinterMessage(LinterMessageCode::KEY_MISSING, m.node_id) << "missing option 'url'";
        }
    }

    // Explicit URI?
    if (auto m = fetch->ast_[SX_FETCH_FROM_URI]; m) {
        auto node_id = fetch->ast_[SX_FETCH_FROM_URI].node_id;
        auto& node = program.nodes[node_id];

        // Match method prefixe
        fetch->url_ = std::string{trimview(instance.TextAt(node.location()), isNoQuote)};
        if (std::regex_match(fetch->url_, HTTP_PREFIX)) {
            fetch->method_ = sx::FetchMethodType::HTTP;
        }
        optionIsRedundant(SX_FETCH_URL_OPTION, "url");
    }
    return fetch;
}

/// Print the options as json
void FetchStatement::PrintExtraAsJSON(std::ostream& out, bool pretty) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];
    json::DocumentWriter writer{instance_, stmt->root_node, ast_};
    writer.writeAsJSON(out, pretty, true);
}

/// Pack the load statement
fb::Offset<ana::FetchStatement> FetchStatement::Pack(fb::FlatBufferBuilder& builder) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];

    // Encode the url
    auto url = builder.CreateString(url_);
    // Print the options
    flatbuffers::Offset<flatbuffers::String> extra;
    {
        std::stringstream out;
        PrintExtraAsJSON(out, false);
        extra = builder.CreateString(out.str());
    }

    proto::analyzer::FetchStatementBuilder eb{builder};
    eb.add_statement_id(statement_id_);
    eb.add_method(method_);
    eb.add_url(url);
    eb.add_extra(extra);
    return eb.Finish();
}

}  // namespace dashql
