#include "dashql/analyzer/stmt/input_stmt.h"

#include "arrow/visitor_inline.h"
#include "dashql/analyzer/json_writer.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/string.h"
#include "dashql/proto_generated.h"

namespace fb = flatbuffers;

namespace dashql {

constexpr size_t SX_POS = 0;
constexpr size_t SX_POS_ROW = 1;
constexpr size_t SX_POS_COLUMN = 2;
constexpr size_t SX_POS_WIDTH = 3;
constexpr size_t SX_POS_HEIGHT = 4;
constexpr size_t SX_ROW = 5;
constexpr size_t SX_COLUMN = 6;
constexpr size_t SX_WIDTH = 7;
constexpr size_t SX_HEIGHT = 8;
constexpr size_t SX_TITLE = 9;
constexpr size_t SX_TYPE = 10;
constexpr size_t SX_INPUT_COMPONENT_TYPE = 11;
constexpr size_t SX_INPUT_VALUE_TYPE = 12;
constexpr size_t SX_STATEMENT_NAME = 13;

InputStatement::InputStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast)
    : instance_(instance), statement_id_(statement_id), ast_(ast) {}

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
            sxm::Attribute(sx::AttributeKey::DASHQL_INPUT_COMPONENT_TYPE, SX_INPUT_COMPONENT_TYPE)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_INPUT_VALUE_TYPE, SX_INPUT_VALUE_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_STATEMENT_NAME, SX_STATEMENT_NAME),
            sxm::Attribute(sx::AttributeKey::DSON_POSITION, SX_POS)
                .MatchDSON()
                .MatchChildren({
                    sxm::Attribute(sx::AttributeKey::DSON_ROW, SX_POS_ROW),
                    sxm::Attribute(sx::AttributeKey::DSON_COLUMN, SX_POS_COLUMN),
                    sxm::Attribute(sx::AttributeKey::DSON_WIDTH, SX_POS_WIDTH),
                    sxm::Attribute(sx::AttributeKey::DSON_HEIGHT, SX_POS_HEIGHT),
                }),
            sxm::Attribute(sx::AttributeKey::DSON_ROW, SX_ROW),
            sxm::Attribute(sx::AttributeKey::DSON_COLUMN, SX_COLUMN),
            sxm::Attribute(sx::AttributeKey::DSON_WIDTH, SX_WIDTH),
            sxm::Attribute(sx::AttributeKey::DSON_HEIGHT, SX_HEIGHT),
            sxm::Attribute(sx::AttributeKey::DSON_TITLE, SX_TITLE),
        });
    // clang-format on

    auto matches = schema.Match(instance, stmt->root_node, 14);

    assert(matches[SX_STATEMENT_NAME]);
    assert(matches[SX_INPUT_VALUE_TYPE]);
    auto statement_name_node = matches[SX_STATEMENT_NAME].node_id;

    // Create the viz statement
    auto input = std::make_unique<InputStatement>(instance, stmt_id, matches);

    // Read the sql type
    auto value_type_node_id = matches[SX_INPUT_VALUE_TYPE].node_id;
    auto value_type = SQLType::ReadFrom(instance, value_type_node_id);
    input->value_type_ = SQLType::SQLNULL();
    if (value_type.ok()) {
        input->value_type_ = value_type.MoveValueUnsafe();
    }

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
        auto zero = arrow::MakeScalar(arrow::uint64(), 0).ValueUnsafe();
        auto r = instance.ReadNodeValueOrNull(pos_row->node_id)->CastTo(arrow::uint64()).ValueOr(zero);
        auto c = instance.ReadNodeValueOrNull(pos_column->node_id)->CastTo(arrow::uint64()).ValueOr(zero);
        auto w = instance.ReadNodeValueOrNull(pos_width->node_id)->CastTo(arrow::uint64()).ValueOr(zero);
        auto h = instance.ReadNodeValueOrNull(pos_height->node_id)->CastTo(arrow::uint64()).ValueOr(zero);
        auto getu64 = [](auto& ptr) { return reinterpret_cast<arrow::UInt64Scalar&>(*ptr).value; };
        input->specified_position_ = proto::analyzer::CardPosition(getu64(r), getu64(c), getu64(w), getu64(h));
    }

    /// Get the title attribute
    if (matches[SX_TITLE]) {
        auto title = instance.ReadNodeValueOrNull(matches[SX_TITLE].node_id)->ToString();
        trim(title, isNoQuote);
        input->title_ = std::move(title);
    }

    return input;
}

std::string_view InputStatement::GetStatementName() const {
    auto& node = instance_.program().nodes[ast_[SX_STATEMENT_NAME].node_id];
    return instance_.TextAt(node.location());
}

/// Print statement as script
void InputStatement::PrintScript(std::ostream& out) const {
    auto& program = instance_.program();
    auto& nodes = instance_.program().nodes;
    auto& stmt = program.statements[statement_id_];

    // Write prefix
    out << "INPUT ";
    out << instance_.TextAt(nodes[ast_[SX_STATEMENT_NAME].node_id].location());
    out << " TYPE ";
    out << instance_.TextAt(nodes[ast_[SX_INPUT_VALUE_TYPE].node_id].location());

    // Create document writer
    std::stringstream options_buffer;
    json::DocumentWriter writer{instance_, stmt->root_node, ast_};
    // Update position
    if (specified_position_) {
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
        json::SAXDocumentBuilder node{sx::AttributeKey::DSON_POSITION};
        node.StartObject();
        node.Key("row");
        node.Uint(specified_position_->row());
        node.Key("column");
        node.Uint(specified_position_->column());
        node.Key("width");
        node.Uint(specified_position_->width());
        node.Key("height");
        node.Uint(specified_position_->height());
        node.EndObject(4);
        writer.patch().Append(stmt->root_node, node.Finish());
    }
    writer.writeAsScript(options_buffer, true, true);
    auto options_str = options_buffer.str();

    if (component_type_ || options_str.empty()) {
        out << " USING ";
    }
    if (component_type_ && component_type_.value() != proto::syntax::InputComponentType::NONE) {
        auto tt = proto::syntax::InputComponentTypeTypeTable();
        auto name = tt->names[static_cast<size_t>(component_type_.value())];
        out << name;
        out << " ";
    }
    out << options_str;
}

/// Pack the viz specs
flatbuffers::Offset<proto::analyzer::Card> InputStatement::PackCard(flatbuffers::FlatBufferBuilder& builder) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];

    // Pack title (if any)
    std::optional<fb::Offset<fb::String>> title_offset = std::nullopt;
    if (title_) {
        title_offset = builder.CreateString(*title_);
    } else {
        title_offset = builder.CreateString(stmt->name_pretty);
    }

    // Print the options
    flatbuffers::Offset<flatbuffers::String> extra;
    {
        std::stringstream out;
        json::DocumentWriter writer{instance_, stmt->root_node, ast_};
        writer.writeAsJSON(out, false, true);
        extra = builder.CreateString(out.str());
    }

    // Pack the value type
    auto value_type = value_type_->Pack(builder);

    // Build viz spec
    assert(computed_position_.has_value());
    proto::analyzer::CardBuilder cb{builder};
    cb.add_card_type(dashql::proto::analyzer::CardType::BUILTIN_VIZ);
    cb.add_card_position(&computed_position_.value());
    if (title_offset) cb.add_card_title(*title_offset);
    cb.add_statement_id(statement_id_);
    cb.add_input_extra(extra);
    cb.add_input_value_type(value_type);
    return cb.Finish();
}

}  // namespace dashql
