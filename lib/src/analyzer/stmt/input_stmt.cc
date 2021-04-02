#include "dashql/analyzer/stmt/input_stmt.h"

#include "dashql/analyzer/json.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/string.h"
#include "dashql/proto_generated.h"

namespace fb = flatbuffers;

namespace dashql {

InputStatement::InputStatement(ProgramInstance& instance, size_t statement_id, size_t statement_name_node,
                               size_t type_node)
    : instance_(instance),
      statement_id_(statement_id),
      statement_name_node_(statement_name_node),
      type_node_(type_node),
      patches_() {}

std::unique_ptr<InputStatement> InputStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];

    // Eagerly abort if not an input statement
    if (program.nodes[stmt->root_node].node_type() != sx::NodeType::OBJECT_DASHQL_INPUT) {
        return nullptr;
    }

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
    constexpr size_t ID_INPUT_COMPONENT_TYPE = 10;
    constexpr size_t ID_INPUT_VALUE_TYPE = 11;
    constexpr size_t ID_STATEMENT_NAME = 12;

    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_INPUT)
        .MatchChildren({
            sxm::Option(sx::AttributeKey::DASHQL_INPUT_COMPONENT_TYPE, ID_INPUT_COMPONENT_TYPE)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE),
            sxm::Option(sx::AttributeKey::DASHQL_INPUT_VALUE_TYPE, ID_INPUT_VALUE_TYPE),
            sxm::Option(sx::AttributeKey::DASHQL_STATEMENT_NAME, ID_STATEMENT_NAME),
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

    std::array<NodeMatch, 13> matches;
    schema.Match(instance, stmt->root_node, matches);

    assert(matches[ID_STATEMENT_NAME]);
    assert(matches[ID_INPUT_VALUE_TYPE]);
    auto statement_name_node = matches[ID_STATEMENT_NAME].node_id;
    auto type_node = matches[ID_INPUT_VALUE_TYPE].node_id;

    // Create the viz statement
    auto input = std::make_unique<InputStatement>(instance, stmt_id, statement_name_node, type_node);

    /// Get the component type
    if (matches[ID_INPUT_COMPONENT_TYPE]) {
        auto type = matches[ID_INPUT_COMPONENT_TYPE].DataAsEnum<sx::InputComponentType>();
        input->component_type_ = type;
    }

    /// Get position attributes
    auto& i = instance;
    auto pos_row = SelectAltOption(i, "position.row", matches[ID_POS_ROW].node_id, matches[ID_ROW].node_id);
    auto pos_column = SelectAltOption(i, "position.column", matches[ID_POS_COLUMN].node_id, matches[ID_COLUMN].node_id);
    auto pos_width = SelectAltOption(i, "position.width", matches[ID_POS_WIDTH].node_id, matches[ID_WIDTH].node_id);
    auto pos_height = SelectAltOption(i, "position.height", matches[ID_POS_HEIGHT].node_id, matches[ID_HEIGHT].node_id);
    if (AnyOptionSet({pos_row, pos_column, pos_width, pos_height})) {
        auto r = instance.ReadNodeValueOrNull(pos_row).CastAsUI64().value_or(0);
        auto c = instance.ReadNodeValueOrNull(pos_column).CastAsUI64().value_or(0);
        auto w = instance.ReadNodeValueOrNull(pos_width).CastAsUI64().value_or(0);
        auto h = instance.ReadNodeValueOrNull(pos_height).CastAsUI64().value_or(0);
        input->position_ = proto::analyzer::CardPosition(r, c, w, h);
    }

    /// Get the title attribute
    if (matches[ID_TITLE]) {
        auto title = instance.ReadNodeValueOrNull(matches[ID_TITLE].node_id).PrintValue();
        trim(title, isNoQuote);
        input->title_ = std::move(title);
    }

    return input;
}

/// Print statement as script
void InputStatement::PrintScript(std::ostream& out) const {
    auto& program = instance_.program();
    auto& nodes = instance_.program().nodes;
    auto& stmt = program.statements[statement_id_];

    // Write prefix
    out << "INPUT ";
    out << instance_.TextAt(nodes[statement_name_node_].location());
    out << " TYPE ";
    out << instance_.TextAt(nodes[type_node_].location());
    if (component_type_) {
        out << " USING ";
        auto tt = proto::syntax::InputComponentTypeTypeTable();
        auto name = tt->names[static_cast<size_t>(component_type_.value())];
        out << name;
        out << " ";
    }

    // Read options as DOM
    auto options = readOptionsAsDOM(instance_, stmt->root_node);

    // Update position
    if (position_) {
        options.RemoveMember("position");
        if (position_) {
            rapidjson::Value pos{rapidjson::kObjectType};
            rapidjson::Value row{position_->row()};
            rapidjson::Value column{position_->column()};
            rapidjson::Value width{position_->width()};
            rapidjson::Value height{position_->height()};
            pos.AddMember("row", row, options.GetAllocator());
            pos.AddMember("column", column, options.GetAllocator());
            pos.AddMember("width", width, options.GetAllocator());
            pos.AddMember("height", height, options.GetAllocator());
            options.AddMember("position", std::move(pos), options.GetAllocator());
        }
    }
    writeSQLJSON(options, out);
}

/// Pack the viz specs
flatbuffers::Offset<proto::analyzer::Card> InputStatement::PackCard(flatbuffers::FlatBufferBuilder& builder) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];

    // Pack title (if any)
    std::optional<fb::Offset<fb::String>> title_offset = std::nullopt;
    if (title_) {
        title_offset = builder.CreateString(*title_);
    }

    // Print the options
    flatbuffers::Offset<flatbuffers::String> options;
    {
        std::stringstream out;
        writeOptionsAsJSON(instance_, stmt->root_node, out, false);
        options = builder.CreateString(out.str());
    }

    // Build viz spec
    proto::analyzer::CardBuilder cb{builder};
    cb.add_card_type(dashql::proto::analyzer::CardType::BUILTIN_VIZ);
    cb.add_statement_id(statement_id_);
    cb.add_input_options(options);
    if (position_) cb.add_position(&position_.value());
    if (title_offset) cb.add_title(*title_offset);
    return cb.Finish();
}

}  // namespace dashql
