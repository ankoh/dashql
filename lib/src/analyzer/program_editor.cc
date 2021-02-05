#include "dashql/analyzer/program_editor.h"

#include <iostream>
#include <stack>
#include <unordered_map>

#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/span.h"
#include "dashql/common/substring_buffer.h"

namespace dashql {

namespace fb = flatbuffers;
namespace sx = proto::syntax;

/// Get an option label
static std::string_view getOptionLabel(sx::AttributeKey key) {
    static const std::unordered_map<sx::AttributeKey, std::string_view> labels = {
#define X(KEY, NAME) {sx::AttributeKey::KEY, NAME},
        X(DASHQL_OPTION_POSITION, "pos")
#undef X
    };
    auto iter = labels.find(key);
    return (iter == labels.end()) ? "?" : iter->second;
}

struct OptionEdit {
    /// The attribute key
    sx::AttributeKey key = sx::AttributeKey::NONE;
    /// Destructor
    virtual ~OptionEdit() = default;
    /// Write the option key
    virtual void WriteKey(std::ostream& out) const = 0;
    /// Write the option value
    virtual void WriteValue(std::ostream& out) const = 0;
};

struct VizChangePosition : public OptionEdit {
    /// The position
    const proto::viz::VizTile& pos;
    /// Constructor
    VizChangePosition(const proto::viz::VizTile& pos) : pos(pos) { key = sx::AttributeKey::DASHQL_OPTION_POSITION; }
    /// Write the option key
    void WriteKey(std::ostream& out) const override { out << getOptionLabel(key); }
    /// Write the option value
    void WriteValue(std::ostream& out) const override {
        out << "(x = " << pos.row() << ", y = " << pos.column() << ", w = " << pos.width() << ", h = " << pos.height()
            << ")";
    }
};

/// Rewrite a viz statement
std::string ProgramEditor::RewriteVizStatement(size_t stmt_id,
                                               nonstd::span<const proto::edit::EditOperation*> edits) const {
    auto& stmt = *instance_.program().statements[stmt_id];
    auto& root = instance_.program().nodes[stmt.root_node];

    // Match the schema
    // clang-format off
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_TARGET, 0),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_TYPE, 1),
            sxm::Attribute(sx::AttributeKey::DASHQL_OPTION_POSITION, 2)
        ));
    // clang-format on
    std::array<NodeMatching, 3> matching;
    schema.Match(instance_, root, matching);

    /// Collect edit operations
    std::array<std::unique_ptr<OptionEdit>, 3> ops;
    for (auto* e : edits) {
        switch (e->variant_type()) {
            case proto::edit::EditOperationVariant::VizChangePosition: {
                auto viz = e->variant_as_VizChangePosition();
                ops[2] = std::make_unique<VizChangePosition>(*e->variant_as_VizChangePosition()->position());
                break;
            }
            default:
                break;
        }
    }

    // Start the statement
    std::stringstream out;
    out << "VIZ ";
    if (matching[0].status == NodeMatchingStatus::MATCHED) {
        out << instance_.TextAt(matching[0].node->location()) << " ";
    }
    if (matching[1].status == NodeMatchingStatus::MATCHED) {
        out << "USING " << instance_.TextAt(matching[1].node->location());
    }

    // Helper to add an option
    size_t options = 0;
    auto add_option = [&]() {
        size_t oid = options++;
        if (oid == 0) {
            out << " (\n    ";
        } else if (oid > 0) {
            out << ",\n    ";
        }
    };
    auto end_options = [&]() {
        if (options > 0) {
            out << "\n)";
        }
    };

    // Process option updates
    for (size_t i = 2; i < matching.size(); ++i) {
        // Node not matched?
        if (matching[i].status != NodeMatchingStatus::MATCHED) continue;
        auto* node = matching[i].node;

        // Write option prefix
        add_option();
        out << getOptionLabel(node->attribute_key()) << " = ";
        if (!!ops[i]) {
            ops[i]->WriteValue(out);
            ops[i].reset();
        } else {
            out << instance_.TextAt(node->location());
        }
    }

    // Process new option
    for (auto& op : ops) {
        if (!op) continue;
        add_option();
        op->WriteKey(out);
        out << " = ";
        op->WriteValue(out);
    }
    end_options();

    return out.str();
}

ProgramEditor::ProgramEditor(ProgramInstance& program) : instance_(program) {}

std::string ProgramEditor::Apply(const proto::edit::ProgramEdit& pe) {
    SubstringBuffer buffer{instance_.program_text()};

    /// Sort the edit operations by statement id
    std::vector<const proto::edit::EditOperation*> ops{pe.edits()->begin(), pe.edits()->end()};
    std::sort(ops.begin(), ops.end(), [&](auto* l, auto* r) { return l->statement_id() < r->statement_id(); });

    for (auto iter = ops.begin(); iter != ops.end();) {
        /// Find all operations that refer to the statement id
        auto next = std::upper_bound(iter, ops.end(), *iter, [&](auto* target, auto* candidate) {
            return target->statement_id() < candidate->statement_id();
        });
        nonstd::span<const proto::edit::EditOperation*> stmt_ops{&*iter, static_cast<unsigned long>(next - iter)};
        assert(!stmt_ops.empty());

        // Process the operations
        auto stmt_id = stmt_ops[0]->statement_id();
        auto& stmt = *instance_.program().statements[stmt_id];
        auto& stmt_root = instance_.program().nodes[stmt.root_node];
        switch (stmt.statement_type) {
            case sx::StatementType::VIZUALIZE: {
                buffer.Replace(stmt_root.location(), RewriteVizStatement(stmt_id, stmt_ops));
                break;
            }

            default:
                assert(false && "editing not implemented for statement type");
                break;
        }

        // Switch to next statement id
        iter = next;
    }

    // Finish the edits
    return buffer.Finish();
}

}  // namespace dashql
