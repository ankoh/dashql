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

VizStatement::VizStatement(const ProgramInstance& instance, const sx::Node& node, const sx::Node& target, std::vector<std::unique_ptr<VizComponent>>&& components)
    : instance_(instance), node_(node), target_(target), components_(move(components)) {}

/// Read a viz statement
std::unique_ptr<VizStatement> VizStatement::ReadFrom(const ProgramInstance& instance,
                                                     const proto::syntax::StatementT& stmt) {
    // clang-format off
    auto& program = instance.program();
    auto& root = program.nodes[stmt.root_node];
    auto root_schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_TARGET, 0),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENTS, 1)
                .MatchArray(),
        ));
    // clang-format on

    // Match root
    std::array<NodeMatching, 2> root_matching;
    if (!root_schema.Match(instance, root, root_matching)) return nullptr;
    auto& comps_node = root_matching[1].node;

    // Read all components
    std::vector<std::unique_ptr<viz::VizComponent>> components;
    components.reserve(comps_node->children_count());
    for (auto cid = 0; cid < comps_node->children_count(); ++cid) {
        auto begin = comps_node->children_begin_or_value();
        auto comp = viz::VizComponent::ReadFrom(instance, program.nodes[begin + cid]);
        components.push_back(move(comp));
    }

    return std::make_unique<VizStatement>(instance, root, *root_matching[0].node, std::move(components));
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
    out << ";\n";
}

/// Read component from a node
std::unique_ptr<VizComponent> VizComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    // clang-format off
    auto& program = instance.program();
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE, 0)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE_SPECIFIER, 1)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE_SPECIFIER),
        ));
    // clang-format on

    return nullptr;
}

/// Read component
std::unique_ptr<VizComponent> TableChartComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    return nullptr;
}

/// Print as script
void TableChartComponent::PrintScript(std::ostream& out) const {}

/// Read component
std::unique_ptr<VizComponent> LineChartComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    return nullptr;
}

/// Print as script
void LineChartComponent::PrintScript(std::ostream& out) const {}

/// Read component
std::unique_ptr<VizComponent> ScatterChartComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    return nullptr;
}

/// Print as script
void ScatterChartComponent::PrintScript(std::ostream& out) const {}

/// Read component
std::unique_ptr<VizComponent> AreaChartComponent::ReadFrom(const ProgramInstance& instance, const sx::Node& node) {
    return nullptr;
}

/// Print as script
void AreaChartComponent::PrintScript(std::ostream& out) const {}

}  // namespace viz
}  // namespace dashql