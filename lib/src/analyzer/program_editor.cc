#include "dashql/analyzer/program_editor.h"

#include <iostream>
#include <stack>
#include <unordered_map>

#include "dashql/analyzer/stmt/input_stmt.h"
#include "dashql/analyzer/stmt/viz_stmt.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/proto_generated.h"
#include "nonstd/span.h"

namespace dashql {

namespace sx = proto::syntax;

struct VizEditOp {
    /// The attribute key
    sx::AttributeKey key = sx::AttributeKey::NONE;
    /// Destructor
    virtual ~VizEditOp() = default;
    /// Edit a component
    virtual void EditComponent(size_t idx, VizComponent& component) = 0;
};

struct VizChangePositionOp : public VizEditOp {
    /// The position
    const proto::edit::CardPositionUpdate& edit;
    /// Constructor
    VizChangePositionOp(const proto::edit::CardPositionUpdate& edit) : edit(edit) {
        key = sx::AttributeKey::DSON_POSITION;
    }
    /// Edit a component
    void EditComponent(size_t idx, VizComponent& component) {
        if (idx == 0) {
            component.SetPosition(*edit.position());
            component.statement().specified_position() = &component.position().value();
        } else {
            component.ClearPosition();
        }
    }
};

/// Rewrite a viz statement
std::string ProgramEditor::RewriteVizStatement(size_t stmt_id,
                                               nonstd::span<const proto::edit::EditOperation*> edits) const {
    auto& stmt = *instance_.program().statements[stmt_id];
    auto& root = instance_.program().nodes[stmt.root_node];
    auto viz = VizStatement::ReadFrom(instance_, stmt_id);
    if (!viz) {
        return std::string{instance_.TextAt(root.location())};
    }

    /// Collect all edit operations
    std::vector<std::unique_ptr<VizEditOp>> ops;
    ops.reserve(edits.size());
    for (auto* e : edits) {
        switch (e->variant_type()) {
            case proto::edit::EditOperationVariant::CardPositionUpdate: {
                auto viz = e->variant_as_CardPositionUpdate();
                ops.push_back(std::make_unique<VizChangePositionOp>(*e->variant_as_CardPositionUpdate()));
                break;
            }
            default:
                break;
        }
    }

    // Apply edit operations to all components
    auto& components = viz->components();
    for (auto i = 0; i < components.size(); ++i) {
        for (auto& op : ops) {
            op->EditComponent(i, *components[i]);
        }
    }

    // Print the statement
    std::stringstream out;
    viz->PrintScript(out);
    return out.str();
}

/// Rewrite a standard statement
std::string ProgramEditor::RewriteInputStatement(size_t stmt_id,
                                                 nonstd::span<const proto::edit::EditOperation*> edits) const {
    auto& stmt = *instance_.program().statements[stmt_id];
    auto& root = instance_.program().nodes[stmt.root_node];
    auto input = InputStatement::ReadFrom(instance_, stmt_id);
    if (!input) {
        return std::string{instance_.TextAt(root.location())};
    }

    // Apply all edits directly
    for (auto* e : edits) {
        switch (e->variant_type()) {
            case proto::edit::EditOperationVariant::CardPositionUpdate: {
                auto up = e->variant_as_CardPositionUpdate();
                input->specified_position() = *up->position();
                break;
            }
            default:
                break;
        }
    }

    // Print the statement
    std::stringstream out;
    input->PrintScript(out);
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
            case sx::StatementType::INPUT: {
                buffer.Replace(stmt_root.location(), RewriteInputStatement(stmt_id, stmt_ops));
                break;
            }
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
