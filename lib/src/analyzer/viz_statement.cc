#include "dashql/analyzer/viz_statement.h"

#include <flatbuffers/flatbuffers.h>

#include <iostream>
#include <stack>
#include <unordered_map>

#include "dashql/analyzer/program_editor.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/span.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/proto_generated.h"

namespace pv = dashql::proto::viz;
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

VizStatement::VizStatement(const ProgramInstance& instance, size_t statement_id, const sx::Node& target,
                           std::vector<std::unique_ptr<VizComponent>>&& components)
    : instance_(instance), statement_id_(statement_id), target_(target), components_(move(components)) {}

/// Read a viz statement
std::unique_ptr<VizStatement> VizStatement::ReadFrom(const ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    auto& root = program.nodes[stmt->root_node];
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
    if (!schema.Match(instance, root, matches)) return nullptr;
    auto& comps_node = matches[1].node;

    // Read all components
    std::vector<std::unique_ptr<viz::VizComponent>> components;
    components.reserve(comps_node->children_count());
    for (auto cid = 0; cid < comps_node->children_count(); ++cid) {
        auto begin = comps_node->children_begin_or_value();
        auto comp = viz::VizComponent::CreateFrom(instance, program.nodes[begin + cid]);
        components.push_back(move(comp));
    }

    return std::make_unique<VizStatement>(instance, stmt_id, *matches[0].node, std::move(components));
}

/// Print statement as script
void VizStatement::PrintScript(std::ostream& out) const {
    out << "VIZ ";
    out << instance_.TextAt(target_.location());
    out << " USING";
    for (auto i = 0; i < components_.size(); ++i) {
        if (i > 0) {
            out << ", ";
        }
        components_[i]->PrintScript(out);
    }
}

/// Pack the viz specs
flatbuffers::Offset<proto::viz::VizSpec> VizStatement::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    // Pack components
    std::vector<fb::Offset<proto::viz::VizComponent>> component_offsets;
    for (auto& c : components_) {
        auto component = c->Pack(builder);
        component_offsets.push_back(component);
    }
    auto component_ofs_vec = builder.CreateVector(component_offsets);
    auto position = position_.has_value() ? &position_.value() : nullptr;

    // Build viz spec
    pv::VizSpecBuilder spec_builder{builder};
    spec_builder.add_statement_id(statement_id_);
    spec_builder.add_components(component_ofs_vec);
    if (position) {
        spec_builder.add_position(position);
    }
    return spec_builder.Finish();
}

/// Read common viz attributes.
void VizComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    constexpr size_t ID_TYPE = 0;
    constexpr size_t ID_TYPE_MODIFIERS = 1;
    constexpr size_t ID_POS_ROW = 2;
    constexpr size_t ID_POS_COL = 3;
    constexpr size_t ID_POS_WIDTH = 4;
    constexpr size_t ID_POS_HEIGHT = 5;
    constexpr size_t ID_CATEGORIES = 13;
    constexpr size_t ID_X = 6;
    constexpr size_t ID_Y = 7;
    constexpr size_t ID_Y0 = 8;
    constexpr size_t ID_DATA_CATEGORIES = 12;
    constexpr size_t ID_DATA_X = 9;
    constexpr size_t ID_DATA_Y = 10;
    constexpr size_t ID_DATA_Y0 = 11;
    constexpr size_t ID_STYLE_DATA = 12;
    constexpr size_t ID_STYLE_LABELS = 13;
    constexpr size_t ID_THEME = 14;

    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE, ID_TYPE)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, ID_TYPE_MODIFIERS)
                .MatchUI32Bitmap(),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_CATEGORIES, ID_CATEGORIES),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_DATA)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_CATEGORIES, ID_DATA_CATEGORIES),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_X, ID_DATA_X),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y, ID_DATA_Y),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y0, ID_DATA_Y0),
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_POSITION)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, ID_POS_COL),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, ID_POS_HEIGHT),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, ID_POS_ROW),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, ID_POS_WIDTH),
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_STYLE)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_DATA, ID_STYLE_DATA),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_LABELS, ID_STYLE_LABELS),
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_THEME, ID_THEME),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_X, ID_X),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y, ID_Y),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y0, ID_Y0),
        });
    // clang-format on

    std::array<NodeMatch, 15> matches;
    schema.Match(instance, node, matches);

    if (matches[0]) {
        type = matches[0].DataAsEnum<sx::VizComponentType>();
    }
    if (matches[1]) {
        type_modifiers = matches[1].DataAsI64();
    }
}

/// Read component from a node
std::unique_ptr<VizComponent> VizComponent::CreateFrom(const ProgramInstance& instance, const sx::Node& node) {
    auto c = std::make_unique<VizComponent>();
    c->ReadFrom(instance, node);
    return c;
}

/// Print common viz attributes
void VizComponent::PrintScript(std::ostream& out) const {
    // Print the type modifiers
    static constexpr std::array<std::string_view, 6> type_modifier_names = {
        "STACKED", "DEPENDENT", "INDEPENDENT", "POLAR", "X", "Y",
    };
    for (uint32_t i = 0, modifiers = type_modifiers; i < 6; ++i, modifiers >>= 1) {
        if ((modifiers & ~0b1) == 0) continue;
        out << " " << type_modifier_names[i];
    }

    // Print the type name
    static constexpr std::array<std::string_view, 14> type_names = {
        "AREA", "AXIS",   "BAR", "BOX_PLOT", "CANDLESTICK", "ERROR_BAR", "HISTOGRAM",
        "LINE", "NUMBER", "PIE", "SCATTER",  "TABLE",       "TEXT",      "VORONOI",
    };
    out << " " << type_names[static_cast<size_t>(type)];

    VizAttributePrinter aout{out};
    if (auto p = position) {
        aout.AddKey("pos");
        aout.AddValue() << "(r = " << p->row() << ", c = " << p->column() << ", w = " << p->width()
                        << ", h = " << p->height() << ")";
    }
}

/// Pack as buffer
flatbuffers::Offset<proto::viz::VizComponent> VizComponent::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    proto::viz::VizComponentBuilder cb{builder};
    return cb.Finish();
}

}  // namespace viz
}  // namespace dashql