#include "dashql/analyzer/stmt/input_stmt.h"

#include "dashql/analyzer/json_writer.h"
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

constexpr size_t SX_POS_ROW = 0;
constexpr size_t SX_POS_COLUMN = 1;
constexpr size_t SX_POS_WIDTH = 2;
constexpr size_t SX_POS_HEIGHT = 3;
constexpr size_t SX_ROW = 4;
constexpr size_t SX_COLUMN = 5;
constexpr size_t SX_WIDTH = 6;
constexpr size_t SX_HEIGHT = 7;
constexpr size_t SX_TITLE = 8;
constexpr size_t SX_TYPE = 9;
constexpr size_t SX_INPUT_COMPONENT_TYPE = 10;
constexpr size_t SX_INPUT_VALUE_TYPE = 11;
constexpr size_t SX_STATEMENT_NAME = 12;

std::unique_ptr<InputStatement> InputStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];

    // Eagerly abort if not an input statement
    if (program.nodes[stmt->root_node].node_type() != sx::NodeType::OBJECT_DASHQL_INPUT) {
        return nullptr;
    }

    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_INPUT)
        .MatchChildren({
            sxm::Option(sx::AttributeKey::DASHQL_INPUT_COMPONENT_TYPE, SX_INPUT_COMPONENT_TYPE)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE),
            sxm::Option(sx::AttributeKey::DASHQL_INPUT_VALUE_TYPE, SX_INPUT_VALUE_TYPE),
            sxm::Option(sx::AttributeKey::DASHQL_STATEMENT_NAME, SX_STATEMENT_NAME),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, SX_ROW),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, SX_COLUMN),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, SX_WIDTH),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, SX_HEIGHT),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_POSITION)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, SX_POS_ROW),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, SX_POS_COLUMN),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, SX_POS_WIDTH),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, SX_POS_HEIGHT),
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_TITLE, SX_TITLE),
        });
    // clang-format on

    auto matches = schema.Match(instance, stmt->root_node, 13);

    assert(matches[SX_STATEMENT_NAME]);
    assert(matches[SX_INPUT_VALUE_TYPE]);
    auto statement_name_node = matches[SX_STATEMENT_NAME].node_id;
    auto type_node = matches[SX_INPUT_VALUE_TYPE].node_id;

    // Create the viz statement
    auto input = std::make_unique<InputStatement>(instance, stmt_id, statement_name_node, type_node);

    /// Get the component type
    if (matches[SX_INPUT_COMPONENT_TYPE]) {
        auto type = matches[SX_INPUT_COMPONENT_TYPE].DataAsEnum<sx::InputComponentType>();
        input->component_type_ = type;
    }

    /// Get position attributes
    auto& i = instance;
    auto pos_row = matches.SelectAlt(SX_POS_ROW, SX_ROW);
    auto pos_column = matches.SelectAlt(SX_POS_COLUMN, SX_COLUMN);
    auto pos_width = matches.SelectAlt(SX_POS_WIDTH, SX_WIDTH);
    auto pos_height = matches.SelectAlt(SX_POS_HEIGHT, SX_HEIGHT);
    if (matches.HasAny({pos_row, pos_column, pos_width, pos_height})) {
        auto r = instance.ReadNodeValueOrNull(pos_row->node_id).CastAsUI64().value_or(0);
        auto c = instance.ReadNodeValueOrNull(pos_column->node_id).CastAsUI64().value_or(0);
        auto w = instance.ReadNodeValueOrNull(pos_width->node_id).CastAsUI64().value_or(0);
        auto h = instance.ReadNodeValueOrNull(pos_height->node_id).CastAsUI64().value_or(0);
        input->position_ = proto::analyzer::CardPosition(r, c, w, h);
    }

    /// Get the title attribute
    if (matches[SX_TITLE]) {
        auto title = instance.ReadNodeValueOrNull(matches[SX_TITLE].node_id).PrintValue();
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

    // Create document writer
    json::NodeWriter writer{instance_, stmt->root_node};
    // Update position
    if (position_) {
        writer.patch().Ignore({
            SX_ROW,
            SX_COLUMN,
            SX_WIDTH,
            SX_HEIGHT,
            SX_POS_COLUMN,
            SX_POS_ROW,
            SX_POS_COLUMN,
            SX_POS_HEIGHT,
        });
        json::SAXNodeBuilder node{sx::AttributeKey::DASHQL_OPTION_POSITION};
        node.StartObject();
        node.Key("row");
        node.Uint(position_->row());
        node.Key("column");
        node.Uint(position_->column());
        node.Key("width");
        node.Uint(position_->width());
        node.Key("height");
        node.Uint(position_->height());
        node.EndObject(4);
        writer.patch().Append(stmt->root_node, node.Finish());
    }
    writer.writeOptionsAsSQLJSON(out);
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
        json::NodeWriter writer{instance_, stmt->root_node};
        writer.writeOptionsAsJSON(out);
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
