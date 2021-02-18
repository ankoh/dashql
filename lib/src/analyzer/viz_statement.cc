#include "dashql/analyzer/viz_statement.h"

#include <iostream>
#include <stack>
#include <unordered_map>

#include "dashql/analyzer/program_editor.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/span.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace viz {

namespace sx = proto::syntax;

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

VizStatement::VizStatement(const ProgramInstance& instance, const sx::Node& node, const sx::Node& target,
                           std::vector<std::unique_ptr<VizComponent>>&& components)
    : instance_(instance), node_(node), target_(target), components_(move(components)) {}

/// Read a viz statement
std::unique_ptr<VizStatement> VizStatement::ReadFrom(const ProgramInstance& instance,
                                                     const proto::syntax::StatementT& stmt) {
    // clang-format off
    auto& program = instance.program();
    auto& root = program.nodes[stmt.root_node];
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENTS, 1)
                .MatchArray(),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_TARGET, 0),
        ));
    // clang-format on

    // Match root
    std::array<NodeMatching, 2> matches;
    if (!schema.Match(instance, root, matches)) return nullptr;
    auto& comps_node = matches[1].node;

    // Read all components
    std::vector<std::unique_ptr<viz::VizComponent>> components;
    components.reserve(comps_node->children_count());
    for (auto cid = 0; cid < comps_node->children_count(); ++cid) {
        auto begin = comps_node->children_begin_or_value();
        auto comp = viz::VizComponent::ReadFrom(instance, program.nodes[begin + cid]);
        components.push_back(move(comp));
    }

    return std::make_unique<VizStatement>(instance, root, *matches[0].node, std::move(components));
}

/// Print statement as script
void VizStatement::PrintScript(std::ostream& out) const {
    out << "VIZ ";
    out << instance_.TextAt(target_.location());
    out << " USING ";
    for (auto i = 0; i < components_.size(); ++i) {
        if (i > 0) {
            out << ", ";
        }
        components_[i]->PrintScript(out);
    }
}

/// Read common viz attributes
void VizComponent::ReadAttributes(const ProgramInstance &instance, const sx::Node &node) {
    // clang-format off
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren(NODE_MATCHERS(
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_POSITION)
                .MatchOptions()
                .MatchChildren(NODE_MATCHERS(
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, 1),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, 3),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, 0),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, 2),
                ))
        ));
    // clang-format on

    // Match root
    std::array<NodeMatching, 4> matches;
    schema.Match(instance, node, matches);
    // XXX Assemble things
}

/// Print common viz attributes
void VizComponent::PrintAttributes(VizAttributePrinter& out) const {
    if (auto p = position) {
        out.AddKey("pos");
        out.AddValue() << "(r = " << p->row() << ", c = " << p->column() << ", w = " << p->width() << ", h = " << p->height()
                       << ")";
    }
}

/// Read component from a node
std::unique_ptr<VizComponent> VizComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    // clang-format off
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE, 0)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE),
        ));
    // clang-format on

    std::array<NodeMatching, 1> matches;
    schema.Match(instance, node, matches);
    if (matches[0].status != NodeMatchingStatus::MATCHED) {
        return nullptr;
    }
    switch (matches[0].DataAsEnum<sx::VizComponentType>()) {
        case sx::VizComponentType::TABLE:
            return TableChartComponent::ReadFrom(instance, node);
        case sx::VizComponentType::AREA:
            return AreaChartComponent::ReadFrom(instance, node);
        case sx::VizComponentType::LINE:
            return LineChartComponent::ReadFrom(instance, node);
        case sx::VizComponentType::SCATTER:
            return ScatterChartComponent::ReadFrom(instance, node);
        case sx::VizComponentType::AXIS:
        case sx::VizComponentType::BAR:
        case sx::VizComponentType::BOX:
        case sx::VizComponentType::CANDLESTICK:
        case sx::VizComponentType::ERROR:
        case sx::VizComponentType::HISTOGRAM:
        case sx::VizComponentType::NUMBER:
        case sx::VizComponentType::PIE:
        case sx::VizComponentType::TEXT:
        case sx::VizComponentType::VORONOI:
        case sx::VizComponentType::NONE:
            break;
    }
    return nullptr;
}

/// Read component
std::unique_ptr<VizComponent> TableChartComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    return std::make_unique<TableChartComponent>();
}

/// Print as script
void TableChartComponent::PrintScript(std::ostream& out) const {
    out << "TABLE";
    VizAttributePrinter aout{out};
    VizComponent::PrintAttributes(aout);
}

/// Read component
std::unique_ptr<VizComponent> LineChartComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    auto c = std::make_unique<LineChartComponent>();
    c->VizComponent::ReadAttributes(instance, node);

    // clang-format off
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, 0)
                .MatchUI32Bitmap(),
        ));
    // clang-format on
    std::array<NodeMatching, 1> matches;
    schema.Match(instance, node, matches);

    // Stacked?
    if (matches[0]) {
        // XXX check bitmap
    }

    return c;
}

/// Print as script
void LineChartComponent::PrintScript(std::ostream& out) const {
    out << "LINE";
    VizAttributePrinter aout{out};
    VizComponent::PrintAttributes(aout);
}

/// Read component
std::unique_ptr<VizComponent> ScatterChartComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    // clang-format off
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren(NODE_MATCHERS(
        ));
    // clang-format on
    return std::make_unique<ScatterChartComponent>();
}

/// Print as script
void ScatterChartComponent::PrintScript(std::ostream& out) const { out << "SCATTER"; }

/// Read component
std::unique_ptr<VizComponent> AreaChartComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    // clang-format off
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, 0)
                .MatchUI32Bitmap(),
        ));
    // clang-format on

    return std::make_unique<AreaChartComponent>();
}

/// Print as script
void AreaChartComponent::PrintScript(std::ostream& out) const { out << "AREA"; }

/// Read component
std::unique_ptr<VizComponent> AxisComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    auto c = std::make_unique<AxisComponent>();
    c->VizComponent::ReadAttributes(instance, node);

    // clang-format off
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, 0)
                .MatchUI32Bitmap(),
        ));
    // clang-format on
    std::array<NodeMatching, 1> matches;
    schema.Match(instance, node, matches);

    // Stacked?
    if (matches[0]) {
        // XXX Type modifiers (stacked, dependent, x, y)
    }

    return std::make_unique<AxisComponent>();
}

/// Print as script
void AxisComponent::PrintScript(std::ostream& out) const { out << "AREA"; }

}  // namespace viz
}  // namespace dashql