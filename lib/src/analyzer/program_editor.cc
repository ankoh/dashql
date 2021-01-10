#include "dashql/analyzer/program_editor.h"

#include <iostream>
#include <stack>
#include <unordered_map>

#include "dashql/common/span.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/analyzer/syntax_matcher.h"

namespace dashql {

namespace fb = flatbuffers;
namespace sx = proto::syntax;

/// Change a viz position
static void changeVizPosition(SubstringBuffer& buffer, const ProgramInstance& instance,
                              const proto::edit::VizChangePosition& edit) {
    auto stmt_id = edit.statement_id();
    auto& pos = *edit.position();

    // clang-format off
    auto schema = sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_POSITION)
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_X, 1),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_Y, 2),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_W, 3),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_H, 4),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_WIDTH, 5),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_HEIGHT, 6),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_ROW, 7),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_COLUMN, 8),
        ));
    // clang-format on

    std::array<NodeMatching, 9> matching;
    auto& stmt = instance.program().statements[stmt_id];
    auto& node = instance.program().nodes[stmt->root_node];
    schema.Match(instance, node, matching);
}

ProgramEditor::ProgramEditor(Analyzer& analyzer, ProgramInstance& program)
    : analyzer_(analyzer), current_program_(program) {}

std::string ProgramEditor::Apply(const proto::edit::ProgramEdit& edit) { return current_program_.program_text(); }

}  // namespace dashql
