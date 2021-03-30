#include "dashql/analyzer/stmt/input_stmt.h"

#include "dashql/analyzer/syntax_matcher.h"

namespace fb = flatbuffers;

namespace dashql {

InputStatement::InputStatement(ProgramInstance& instance, size_t statement_id, size_t target_node_id)
    : instance_(instance), statement_id_(statement_id), target_node_id_(target_node_id), patches_() {}

std::unique_ptr<InputStatement> InputStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
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

    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
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
        });
    // clang-format on

    return nullptr;
}

/// Pack the viz specs
flatbuffers::Offset<proto::analyzer::Card> InputStatement::PackCard(flatbuffers::FlatBufferBuilder& builder) const {
    // Pack title (if any)
    std::optional<fb::Offset<fb::String>> title_offset = std::nullopt;
    if (title_) {
        title_offset = builder.CreateString(*title_);
    }

    // Build viz spec
    assert(specified_position_.has_value());
    proto::analyzer::CardBuilder card_builder{builder};
    card_builder.add_card_type(dashql::proto::analyzer::CardType::BUILTIN_VIZ);
    card_builder.add_statement_id(statement_id_);
    card_builder.add_position(&specified_position_.value());
    if (title_offset) card_builder.add_title(*title_offset);
    return card_builder.Finish();
}

}  // namespace dashql
