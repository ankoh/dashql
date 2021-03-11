#include "dashql/analyzer/viz_statement.h"

#include <flatbuffers/flatbuffers.h>
#include <rapidjson/rapidjson.h>

#include <iostream>
#include <limits>
#include <stack>
#include <unordered_map>

#include "dashql/analyzer/json.h"
#include "dashql/analyzer/program_editor.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/program_linter.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/expected.h"
#include "dashql/common/memstream.h"
#include "dashql/common/span.h"
#include "dashql/common/string.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/parser/grammar/enums.h"
#include "dashql/proto_generated.h"
#include "rapidjson/ostreamwrapper.h"
#include "rapidjson/prettywriter.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace fb = flatbuffers;

namespace dashql {
namespace viz {

class VizAttributePrinter {
   protected:
    /// The output
    std::ostream& out;
    /// Already started?
    bool started;
    /// Already finished?
    bool finished;

   public:
    ~VizAttributePrinter();

    /// Constructor
    VizAttributePrinter(std::ostream& out);
    /// Start a key
    void AddKey(std::string_view key);
    /// Start a value
    std::ostream& AddValue();
    /// Finish all options
    void Finish();
};

VizAttributePrinter::VizAttributePrinter(std::ostream& out) : out(out), started(false), finished(false) {}
VizAttributePrinter::~VizAttributePrinter() {
    if (started && !finished) {
        Finish();
    }
}

/// Add a key
void VizAttributePrinter::AddKey(std::string_view key) {
    if (!started) {
        started = true;
        out << " (\n    ";
    } else {
        out << ",\n    ";
    }
    out << key;
}

/// Start a value
std::ostream& VizAttributePrinter::AddValue() {
    out << " = ";
    return out;
}
/// Start a value
void VizAttributePrinter::Finish() {
    finished = true;
    out << "\n)";
}

VizStatement::VizStatement(ProgramInstance& instance, size_t statement_id, size_t target_node_id)
    : instance_(instance), statement_id_(statement_id), target_node_id_(target_node_id), components_() {}

/// Read a viz statement
std::unique_ptr<VizStatement> VizStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENTS, 1)
                .MatchArray(),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_TARGET, 0),
        });
    // clang-format on

    // Match root
    std::array<NodeMatch, 2> matches;
    if (!schema.Match(instance, stmt->root_node, matches)) return nullptr;
    auto comps_node_id = matches[1].node_id;
    auto& comps_node = program.nodes[comps_node_id];

    // Create the viz statement
    auto viz = std::make_unique<VizStatement>(instance, stmt_id, matches[0].node_id);

    // Read all components
    std::vector<std::unique_ptr<viz::VizComponent>> components;
    components.reserve(comps_node.children_count());
    for (auto cid = 0; cid < comps_node.children_count(); ++cid) {
        auto begin = comps_node.children_begin_or_value();
        auto comp = viz::VizComponent::CreateFrom(*viz, begin + cid);
        components.push_back(move(comp));
    }
    viz->components_ = std::move(components);
    return viz;
}

/// Print statement as script
void VizStatement::PrintScript(std::ostream& out) const {
    auto& nodes = instance_.program().nodes;

    out << "VIZ ";
    out << instance_.TextAt(nodes[target_node_id_].location());
    out << " USING";
    for (auto i = 0; i < components_.size(); ++i) {
        if (i > 0) {
            out << ", ";
        }
        components_[i]->PrintScript(out);
    }
}

/// Pack the viz specs
flatbuffers::Offset<proto::analyzer::VizSpec> VizStatement::Pack(flatbuffers::FlatBufferBuilder& builder) const {
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
    }

    // Build viz spec
    assert(computed_position_.has_value());
    proto::analyzer::VizSpecBuilder spec_builder{builder};
    spec_builder.add_statement_id(statement_id_);
    spec_builder.add_components(component_ofs_vec);
    spec_builder.add_position(&computed_position_.value());
    if (title_offset) spec_builder.add_title(*title_offset);
    return spec_builder.Finish();
}

/// Constructor
VizComponent::VizComponent(VizStatement& viz) : viz_stmt_(viz) {}

/// Read common viz attributes.
void VizComponent::ReadFrom(size_t node_id) {
    auto& instance = viz_stmt_.instance();
    auto& nodes = instance.program().nodes;

    /// Read all options as json
    readOptionsAsJSON(instance, node_id, options_);

    // Extract important metadata for the analyzer
    constexpr size_t ID_TYPE = 0;
    constexpr size_t ID_TYPE_MODIFIERS = 1;
    constexpr size_t ID_POS_ROW = 2;
    constexpr size_t ID_POS_COLUMN = 3;
    constexpr size_t ID_POS_WIDTH = 4;
    constexpr size_t ID_POS_HEIGHT = 5;
    constexpr size_t ID_ROW = 6;
    constexpr size_t ID_COLUMN = 7;
    constexpr size_t ID_WIDTH = 8;
    constexpr size_t ID_HEIGHT = 9;
    constexpr size_t ID_TITLE = 10;

    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE, ID_TYPE)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, ID_TYPE_MODIFIERS)
                .MatchUI32Bitmap(),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, ID_COLUMN),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, ID_HEIGHT),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_POSITION)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, ID_POS_COLUMN),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, ID_POS_HEIGHT),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, ID_POS_ROW),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, ID_POS_WIDTH),
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, ID_ROW),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_TITLE, ID_TITLE),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, ID_WIDTH),
        });
    // clang-format on

    std::array<NodeMatch, 11> matches;
    schema.Match(viz_stmt_.instance(), node_id, matches);

    // Read type
    if (matches[ID_TYPE]) {
        type_ = matches[ID_TYPE].DataAsEnum<sx::VizComponentType>();
    }
    // Read type modifiers
    if (matches[ID_TYPE_MODIFIERS]) {
        type_modifiers_ = matches[ID_TYPE_MODIFIERS].DataAsI64();
    }

    // Report that option is not unique
    auto report_not_unique = [this](size_t node_id, std::string_view key) {
        if (node_id == INVALID_NODE_ID) return;
        viz_stmt_.instance().Add(LinterMessage{LinterMessageCode::OPTION_NOT_UNIQUE, node_id}
                                 << "option '" << key << "' must be unique across components");
    };

    /// Get position attributes
    auto pos_row = SelectAltOption("position.row", matches[ID_POS_ROW].node_id, matches[ID_ROW].node_id);
    auto pos_column = SelectAltOption("position.column", matches[ID_POS_COLUMN].node_id, matches[ID_COLUMN].node_id);
    auto pos_width = SelectAltOption("position.width", matches[ID_POS_WIDTH].node_id, matches[ID_WIDTH].node_id);
    auto pos_height = SelectAltOption("position.height", matches[ID_POS_HEIGHT].node_id, matches[ID_HEIGHT].node_id);
    if (AnyOptionSet({pos_row, pos_column, pos_width, pos_height})) {
        // Already provided by a previous component?
        if (viz_stmt_.specified_position()) {
            report_not_unique(pos_row, "position.row");
            report_not_unique(pos_column, "position.column");
            report_not_unique(pos_width, "position.width");
            report_not_unique(pos_height, "position.height");
        } else {
            auto r = viz_stmt_.instance_.ReadNodeValueOrNull(pos_row).CastAsUI64().value_or(0);
            auto c = viz_stmt_.instance_.ReadNodeValueOrNull(pos_column).CastAsUI64().value_or(0);
            auto w = viz_stmt_.instance_.ReadNodeValueOrNull(pos_width).CastAsUI64().value_or(0);
            auto h = viz_stmt_.instance_.ReadNodeValueOrNull(pos_height).CastAsUI64().value_or(0);
            position_ = proto::analyzer::VizPosition(r, c, w, h);
            viz_stmt_.specified_position() = &position_.value();
        }
    }

    /// Get the title attribute
    if (matches[ID_TITLE]) {
        if (viz_stmt_.title()) {
            report_not_unique(matches[ID_TITLE].node_id, "title");
        } else {
            auto title = viz_stmt_.instance_.ReadNodeValueOrNull(matches[ID_TITLE].node_id).PrintValue();
            trim(title, isNoQuote);
            title_ = std::move(title);
            viz_stmt_.title() = title_;
        }
    }
}

/// Select an option
bool VizComponent::AnyOptionSet(std::initializer_list<size_t> node_ids) const {
    bool any = false;
    for (auto node_id : node_ids) {
        any |= node_id < INVALID_NODE_ID;
    }
    return any;
}

/// Select an option with alternative
size_t VizComponent::SelectAltOption(std::string_view label, size_t node_id, size_t alt_node_id) const {
    auto& instance = viz_stmt_.instance();
    size_t selection = INVALID_NODE_ID;
    if (node_id < INVALID_NODE_ID) {
        selection = node_id;
        if (alt_node_id < INVALID_NODE_ID) {
            instance.Add(LinterMessage{LinterMessageCode::OPTION_ALTERNATIVE_STYLE, alt_node_id}
                         << "option superseded by '" << label << "'");
        }
    } else if (alt_node_id < INVALID_NODE_ID) {
        selection = alt_node_id;
        instance.Add(LinterMessage{LinterMessageCode::OPTION_ALTERNATIVE_STYLE, alt_node_id}
                     << "option should be specified as '" << label << "'");
    }
    return selection;
}

/// Read component from a node
std::unique_ptr<VizComponent> VizComponent::CreateFrom(VizStatement& stmt, size_t node_id) {
    auto c = std::make_unique<VizComponent>(stmt);
    c->ReadFrom(node_id);
    return c;
}

/// Print the options as json
void VizComponent::PrintOptionsAsJSON(std::ostream& raw_out, bool pretty) const {
    rapidjson::OStreamWrapper out{raw_out};
    if (pretty) {
        rapidjson::PrettyWriter writer(out);
        options_.Accept(writer);
    } else {
        rapidjson::Writer writer(out);
        options_.Accept(writer);
    }
}

/// Print common viz attributes
void VizComponent::PrintScript(std::ostream& out) const {
    // Print the type modifiers
    for (uint32_t i = 0, modifiers = type_modifiers_; i < 7; ++i, modifiers >>= 1) {
        if ((modifiers & 0b1) == 0) continue;
        out << " " << sx::VizComponentTypeModifierTypeTable()->names[i];
    }

    // Print the type name
    out << " " << sx::VizComponentTypeTypeTable()->names[static_cast<uint32_t>(type_)];

    // Print the position
    VizAttributePrinter aout{out};
    if (auto& p = position_; p.has_value()) {
        aout.AddKey("position");
        aout.AddValue() << "(row = " << p->row() << ", column = " << p->column() << ", width = " << p->width()
                        << ", height = " << p->height() << ")";
    }

    // Print the title
    if (auto& t = title_; t.has_value()) {
        aout.AddKey("title");
        aout.AddValue() << "'" << *t << "'";
    }
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
    std::optional<flatbuffers::Offset<flatbuffers::String>> spec;
    {
        rapidjson::StringBuffer buffer;
        rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
        options_.Accept(writer);
        if (buffer.GetLength() > 0) {
            spec = builder.CreateString(buffer.GetString());
        }
    }

    // Pack component
    proto::analyzer::VizComponentBuilder cb{builder};
    cb.add_type(type_);
    cb.add_type_modifiers(modifiers_vec);
    if (spec) cb.add_component_spec(*spec);
    return cb.Finish();
}

}  // namespace viz
}  // namespace dashql