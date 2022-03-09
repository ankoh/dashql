#include "dashql/analyzer/stmt/viz_stmt.h"

#include "arrow/type_fwd.h"
#include "arrow/visitor_inline.h"
#include "dashql/analyzer/json_patch.h"
#include "dashql/analyzer/json_writer.h"
#include "dashql/analyzer/program_editor.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/program_linter.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/memstream.h"
#include "dashql/common/string.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/parser/grammar/enums.h"
#include "dashql/parser/qualified_name.h"
#include "dashql/proto_generated.h"
#include "flatbuffers/flatbuffers.h"
#include "nonstd/span.h"
#include "rapidjson/ostreamwrapper.h"
#include "rapidjson/prettywriter.h"
#include "rapidjson/rapidjson.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace fb = flatbuffers;

namespace dashql {

constexpr size_t SX_TARGET = 0;
constexpr size_t SX_COMPONENTS = 1;
constexpr size_t SX_TYPE = 2;
constexpr size_t SX_TYPE_MODIFIERS = 3;
constexpr size_t SX_POS = 4;
constexpr size_t SX_POS_ROW = 5;
constexpr size_t SX_POS_COLUMN = 6;
constexpr size_t SX_POS_WIDTH = 7;
constexpr size_t SX_POS_HEIGHT = 8;
constexpr size_t SX_ROW = 9;
constexpr size_t SX_COLUMN = 10;
constexpr size_t SX_WIDTH = 11;
constexpr size_t SX_HEIGHT = 12;
constexpr size_t SX_TITLE = 13;

VizStatement::VizStatement(ProgramInstance& instance, size_t statement_id, ASTIndex ast)
    : instance_(instance), statement_id_(statement_id), ast_(std::move(ast)), components_(), patches_() {}

/// Read a viz statement
std::unique_ptr<VizStatement> VizStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENTS, SX_COMPONENTS)
                .MatchArray(),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_TARGET)
                .MatchObject(sx::NodeType::OBJECT_SQL_TABLE_REF)
                .MatchChildren({
                    sxm::Attribute(sx::AttributeKey::SQL_TABLE_NAME, SX_TARGET)
                        .MatchObject(sx::NodeType::OBJECT_SQL_QUALIFIED_NAME)
                }),
        });
    // clang-format on

    // Match root
    auto ast = schema.Match(instance, stmt->root_node, 2);
    if (!ast.IsFullMatch()) {
        return nullptr;
    }
    auto comps_node_id = ast[SX_COMPONENTS].node_id;
    auto& comps_node = program.nodes[comps_node_id];

    // Create the viz statement
    auto viz = std::make_unique<VizStatement>(instance, stmt_id, std::move(ast));

    // Read viz target
    viz->target_ =
        parser::QualifiedNameView::ReadFrom(program.nodes, instance.program_text(), viz->ast_[SX_TARGET].node_id)
            .WithDefaultSchema(instance.script_options().global_namespace)
            .WithoutIndex();

    // Read all components
    std::vector<std::unique_ptr<VizComponent>> components;
    components.reserve(comps_node.children_count());
    for (auto cid = 0; cid < comps_node.children_count(); ++cid) {
        auto begin = comps_node.children_begin_or_value();
        auto comp = VizComponent::ReadFrom(*viz, begin + cid);
        components.push_back(move(comp));
    }
    viz->components_ = std::move(components);
    return viz;
}

/// Print statement as script
void VizStatement::PrintScript(std::ostream& out) const {
    auto& nodes = instance_.program().nodes;

    out << "VIZ ";
    out << instance_.TextAt(nodes[ast_[SX_TARGET].node_id].location());
    out << " USING";
    for (auto i = 0; i < components_.size(); ++i) {
        if (i > 0) {
            out << ",";
        }
        components_[i]->PrintScript(out);
    }
}

/// Pack the viz specs
flatbuffers::Offset<proto::analyzer::Card> VizStatement::PackCard(flatbuffers::FlatBufferBuilder& builder) const {
    auto& program = instance_.program();
    auto& stmt = program.statements[statement_id_];
    auto target = builder.CreateString(target_.ToString());

    // Pack components
    std::vector<fb::Offset<proto::analyzer::VizComponent>> component_offsets;
    for (auto& c : components_) {
        auto component = c->Pack(builder);
        component_offsets.push_back(component);
    }
    auto component_ofs_vec = builder.CreateVector(component_offsets);

    // Pack title (if any)
    std::optional<fb::Offset<fb::String>> title_offset = std::nullopt;
    if (title_) {
        title_offset = builder.CreateString(*title_);
    } else {
        title_offset = builder.CreateString(target_.ToPrettyString());
    }

    // Build viz spec
    assert(computed_position_.has_value());
    proto::analyzer::CardBuilder card_builder{builder};
    card_builder.add_card_type(dashql::proto::analyzer::CardType::BUILTIN_VIZ);
    card_builder.add_card_position(&computed_position_.value());
    if (title_offset) card_builder.add_card_title(*title_offset);
    card_builder.add_statement_id(statement_id_);
    card_builder.add_viz_target(target);
    card_builder.add_viz_components(component_ofs_vec);
    return card_builder.Finish();
}

/// Constructor
VizComponent::VizComponent(VizStatement& viz, size_t node_id, ASTIndex ast)
    : viz_stmt_(viz), node_id_(node_id), ast_(std::move(ast)) {}

/// Read common viz attributes.
std::unique_ptr<VizComponent> VizComponent::ReadFrom(VizStatement& stmt, size_t node_id) {
    auto& instance = stmt.instance();
    auto& nodes = instance.program().nodes;

    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE, SX_TYPE)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, SX_TYPE_MODIFIERS)
                .MatchUI32Bitmap(),
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

    auto ast = schema.Match(stmt.instance(), node_id, 14);
    auto comp = std::make_unique<VizComponent>(stmt, node_id, std::move(ast));

    // Read type
    if (comp->ast_[SX_TYPE]) {
        comp->type_ = comp->ast_[SX_TYPE].DataAsEnum<sx::VizComponentType>();
    }
    // Read type modifiers
    if (comp->ast_[SX_TYPE_MODIFIERS]) {
        comp->type_modifiers_ = comp->ast_[SX_TYPE_MODIFIERS].DataAsI64();
    }

    // Report that option is not unique
    auto report_not_unique = [&](size_t node_id, std::string_view key) {
        if (node_id == INVALID_NODE_ID) return;
        instance.AddLinterMessage(LinterMessageCode::KEY_NOT_UNIQUE, node_id)
            << "key '" << key << "' must be unique across components";
    };

    /// Get position attributes
    auto& i = instance;
    auto pos_row = comp->ast_.SelectAlt(SX_POS_ROW, SX_ROW);
    auto pos_column = comp->ast_.SelectAlt(SX_POS_COLUMN, SX_COLUMN);
    auto pos_width = comp->ast_.SelectAlt(SX_POS_WIDTH, SX_WIDTH);
    auto pos_height = comp->ast_.SelectAlt(SX_POS_HEIGHT, SX_HEIGHT);
    if (comp->ast_.HasAny({pos_row, pos_column, pos_width, pos_height})) {
        // Already provided by a previous component?
        if (stmt.specified_position()) {
            report_not_unique(pos_row->node_id, "position.row");
            report_not_unique(pos_column->node_id, "position.column");
            report_not_unique(pos_width->node_id, "position.width");
            report_not_unique(pos_height->node_id, "position.height");
        } else {
            auto zero = arrow::MakeScalar(arrow::uint64(), 0).ValueUnsafe();
            auto r = stmt.instance_.ReadNodeValueOrNull(pos_row->node_id)->CastTo(arrow::uint64()).ValueOr(zero);
            auto c = stmt.instance_.ReadNodeValueOrNull(pos_column->node_id)->CastTo(arrow::uint64()).ValueOr(zero);
            auto w = stmt.instance_.ReadNodeValueOrNull(pos_width->node_id)->CastTo(arrow::uint64()).ValueOr(zero);
            auto h = stmt.instance_.ReadNodeValueOrNull(pos_height->node_id)->CastTo(arrow::uint64()).ValueOr(zero);
            auto getu64 = [](auto& ptr) { return reinterpret_cast<arrow::UInt64Scalar&>(*ptr).value; };
            comp->position_ = proto::analyzer::CardPosition(getu64(r), getu64(c), getu64(w), getu64(h));
            stmt.specified_position() = &comp->position_.value();
        }
    }

    /// Get the title attribute
    if (auto match = comp->ast_[SX_TITLE]; match) {
        if (stmt.title()) {
            report_not_unique(match.node_id, "title");
        } else {
            auto title = stmt.instance_.ReadNodeValueOrNull(match.node_id)->ToString();
            trim(title, isNoQuote);
            comp->title_ = std::move(title);
            stmt.title() = comp->title_;
        }
    }
    return comp;
}

/// Print the options as json
void VizComponent::PrintOptionsAsJSON(std::ostream& out, bool pretty) const {
    json::DocumentWriter writer{viz_stmt_.instance_, node_id_, ast_};
    writer.writeAsJSON(out, pretty, true);
}

/// Print common viz attributes
void VizComponent::PrintScript(std::ostream& out) const {
    // Print the type modifiers
    for (uint32_t i = 0, modifiers = type_modifiers_; i < 7; ++i, modifiers >>= 1) {
        if ((modifiers & 0b1) == 0) continue;
        out << " " << sx::VizComponentTypeModifierTypeTable()->names[i];
    }
    // Print the type name
    if (type_ == sx::VizComponentType::SPEC) {
        out << " ";
    } else {
        out << " " << sx::VizComponentTypeTypeTable()->names[static_cast<uint32_t>(type_)] << " ";
    }

    // Create document writer
    json::DocumentWriter writer{viz_stmt_.instance_, node_id_, ast_};
    // Write the position
    if (position_) {
        writer.patch().Ignore({
            SX_ROW,
            SX_COLUMN,
            SX_WIDTH,
            SX_HEIGHT,
            SX_POS,
            SX_POS_ROW,
            SX_POS_COLUMN,
            SX_POS_WIDTH,
            SX_POS_HEIGHT,
        });
        if (&position_.value() == viz_stmt_.specified_position_) {
            json::SAXDocumentBuilder node{sx::AttributeKey::DSON_POSITION};
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
            writer.patch().Append(node_id_, node.Finish());
        }
    }
    writer.writeAsScript(out, true, true);
}

/// Pack as buffer
flatbuffers::Offset<proto::analyzer::VizComponent> VizComponent::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    // Pack modifiers
    std::vector<uint8_t> modifiers;
    for (uint32_t i = 0, m = type_modifiers_; i < 7; ++i, m >>= 1) {
        if ((m & 0b1) == 0) continue;
        modifiers.push_back(i);
    }
    auto modifiers_vec = builder.CreateVector(modifiers);

    // Print the spec
    flatbuffers::Offset<flatbuffers::String> extra;
    {
        std::stringstream out;
        PrintOptionsAsJSON(out, false);
        extra = builder.CreateString(out.str());
    }

    // Pack component
    proto::analyzer::VizComponentBuilder cb{builder};
    cb.add_type(type_);
    cb.add_type_modifiers(modifiers_vec);
    cb.add_extra(extra);
    return cb.Finish();
}

}  // namespace dashql
