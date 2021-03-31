#include "dashql/analyzer/stmt/input_stmt.h"

#include "dashql/analyzer/json.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/proto_generated.h"

namespace fb = flatbuffers;

namespace dashql {

InputStatement::InputStatement(ProgramInstance& instance, size_t statement_id, size_t target_node_id)
    : instance_(instance), statement_id_(statement_id), target_node_id_(target_node_id), patches_() {}

std::unique_ptr<InputStatement> InputStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];

    // Extract important metadata for the analyzer
    constexpr size_t ID_POS_ROW = 0;
    constexpr size_t ID_POS_COLUMN = 1;
    constexpr size_t ID_POS_WIDTH = 2;
    constexpr size_t ID_POS_HEIGHT = 3;
    constexpr size_t ID_ROW = 4;
    constexpr size_t ID_COLUMN = 5;
    constexpr size_t ID_WIDTH = 6;
    constexpr size_t ID_HEIGHT = 7;
    constexpr size_t ID_TITLE = 8;
    constexpr size_t ID_TYPE = 9;

    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_INPUT)
        .MatchChildren({
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, ID_ROW),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, ID_COLUMN),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, ID_WIDTH),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, ID_HEIGHT),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_POSITION)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, ID_POS_ROW),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, ID_POS_COLUMN),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, ID_POS_WIDTH),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, ID_POS_HEIGHT),
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_TITLE, ID_TITLE),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_TYPE, ID_TYPE)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE),
        });
    // clang-format on

    std::array<NodeMatch, 11> matches;
    schema.Match(instance, stmt->root_node, matches);

    // Report that option is not unique
    auto report_not_unique = [&](size_t node_id, std::string_view key) {
        if (node_id == INVALID_NODE_ID) return;
        instance.Add(LinterMessage{LinterMessageCode::OPTION_NOT_UNIQUE, node_id}
                     << "option '" << key << "' must be unique across components");
    };

    /// Get position attributes
    auto& i = instance;
    auto pos_row = SelectAltOption(i, "position.row", matches[ID_POS_ROW].node_id, matches[ID_ROW].node_id);
    auto pos_column = SelectAltOption(i, "position.column", matches[ID_POS_COLUMN].node_id, matches[ID_COLUMN].node_id);
    auto pos_width = SelectAltOption(i, "position.width", matches[ID_POS_WIDTH].node_id, matches[ID_WIDTH].node_id);
    auto pos_height = SelectAltOption(i, "position.height", matches[ID_POS_HEIGHT].node_id, matches[ID_HEIGHT].node_id);
    std::optional<proto::analyzer::CardPosition> specified_position;
    if (AnyOptionSet({pos_row, pos_column, pos_width, pos_height})) {
        auto r = instance.ReadNodeValueOrNull(pos_row).CastAsUI64().value_or(0);
        auto c = instance.ReadNodeValueOrNull(pos_column).CastAsUI64().value_or(0);
        auto w = instance.ReadNodeValueOrNull(pos_width).CastAsUI64().value_or(0);
        auto h = instance.ReadNodeValueOrNull(pos_height).CastAsUI64().value_or(0);
        specified_position = proto::analyzer::CardPosition(r, c, w, h);
    }

    return nullptr;
}

/// Pack the viz specs
flatbuffers::Offset<proto::analyzer::Card> InputStatement::PackCard(flatbuffers::FlatBufferBuilder& builder) const {
    // Pack title (if any)
    std::optional<fb::Offset<fb::String>> title_offset = std::nullopt;
    if (title_) {
        title_offset = builder.CreateString(*title_);
    }

    // Print the options
    flatbuffers::Offset<flatbuffers::String> options;
    {
        std::stringstream out;
        writeOptionsAsJSON(instance_, target_node_id_, out, false);
        options = builder.CreateString(out.str());
    }

    // Build viz spec
    assert(specified_position_.has_value());
    proto::analyzer::CardBuilder cb{builder};
    cb.add_card_type(dashql::proto::analyzer::CardType::BUILTIN_VIZ);
    cb.add_statement_id(statement_id_);
    cb.add_position(&specified_position_.value());
    cb.add_input_options(options);
    if (title_offset) cb.add_title(*title_offset);
    return cb.Finish();
}

}  // namespace dashql
