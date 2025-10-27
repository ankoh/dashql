#include <type_traits>

#include "dashql/view/plan_view_model.h"

namespace dashql {

// This layouting algorithm is based on two papers:
// - A Node-Positioning Algorithm for General Trees:
//   1990 by Walker
//   https://www.cs.unc.edu/techreports/89-034.pdf
//   This is the original tree layouting algorithm that many are using
// - Improving Walker's Algorithm to Run in Linear Time
//   2002 by Buchheim-Juenger-Leipert
//   https://www.researchgate.net/publication/30508504_Improving_Walker%27s_Algorithm_to_Run_in_Linear_Time
//   This is an updated version that fixes quadratic runtime in the original paper.

// Also kudos to the following two implementations for inspiration:
// - https://github.com/cvzi/py_treedraw
// - https://github.com/krishna116/cpp-syntax-tree

/// A node for the layouter
struct PlanLayoutNode {
    /// The parent (if any)
    PlanLayoutNode* parent = nullptr;
    /// The children
    std::span<PlanLayoutNode> children;
    /// The node label
    std::string_view label;

    /// Walker - The current node's preliminary x-coordinate
    double prelim = 0;
    /// Walker - The current node's modifier value.
    ///
    /// We track shifting only at subtree roots instead of eagerly updating the x-coordinates within the tree.
    /// `mod` is a value that is to be added to all preliminary x-coordinates in the subtree rooted at v, except for v
    /// itself.
    ///
    /// The actual x-coordinate of a node is the own preliminary position `prelim` plus all `mod` values on the path to
    /// the root, also called `modsum` in the paper. We traverse top-down in a dedicated pass at the end to compute the
    /// final position in O(n).
    ///
    /// For leafs v with a thread to w, `mod` stores `modsum(v) - modsum(w)`.
    double mod = 0;
    /// Walker - The current node's x-coordinate
    double x = 0;
    /// Walker - The current node's y-coordinate
    double y = 0;
    /// Buchheim - The current node's shifting.
    /// Buchheim memoizes the node shifting to shift non-current subtrees in a single pass.
    /// This is needed to make the central positioning of parents above the children non-quadratic.
    double shift = 0;
    /// Buchheim - The current node's change.
    double change = 0;
    /// Buchheim - Save a node's ancestor.
    PlanLayoutNode* ancestor = nullptr;
    /// Reingold - The node's thread
    PlanLayoutNode* thread = nullptr;

    /// Walker - The current node's hierarchical parent
    PlanLayoutNode* GetParent() { return parent; }
    /// Walker - The current node's leftmost offspring
    /// Must not be a leaf.
    PlanLayoutNode& GetLeftMostChild() {
        assert(!IsLeaf());
        return children.front();
    }
    /// Walker - The current node's rightmost offspring
    /// Must not be a leaf.
    PlanLayoutNode& GetRightMostChild() {
        assert(!IsLeaf());
        return children.back();
    }
    /// Traverse the right contour.
    /// If we're an inner node, we traverse to the right-most child.
    /// If we're a leaf, we traverse to our thread.
    PlanLayoutNode* GetNextAlongRightContour() {
        if (!IsLeaf()) {
            return &GetRightMostChild();
        } else {
            return thread;
        }
    }
    /// Traverse the left contour.
    /// If we're an inner node, we traverse to the left-most child.
    /// If we're a leaf, we traverse to our thread.
    PlanLayoutNode* GetNextAlongLeftContour() {
        if (!IsLeaf()) {
            return &GetLeftMostChild();
        } else {
            return thread;
        }
    }
    /// Is a leaf?
    bool IsLeaf() { return children.empty(); }
    /// Get the node id
    size_t GetNodeId(std::span<PlanLayoutNode> nodes) const { return this - nodes.data(); }

    /// Default constructor
    PlanLayoutNode() = default;
    // Copy constructor (Wasm needs an explicit one)
    PlanLayoutNode(const PlanLayoutNode& other);
};

// Plan layout nodes are only a very shallow structure derived from the flattened plan operators.
static_assert(std::is_trivially_destructible_v<PlanLayoutNode>);

// Wasm needs an explicit copy constructor for the nested span
PlanLayoutNode::PlanLayoutNode(const PlanLayoutNode& other) = default;

struct PlanLayouter {
    /// The view model
    PlanViewModel& view_model;
    /// The plan layout nodes
    std::vector<PlanLayoutNode> nodes;
    /// The plan layout config
    const PlanViewModel::LayoutConfig& layout_config;

    /// The
   protected:
    /// Perform the first walk over the tree
    void FirstWalk(PlanLayoutNode& child, PlanLayoutNode* left_sibling_of_child = nullptr);
    /// Apportion routine of Walker's algorithm
    PlanLayoutNode& Apportion(PlanLayoutNode& child, PlanLayoutNode* left_sibling_of_child,
                              PlanLayoutNode& default_ancestor);
    /// Helper to move a subtree
    void MoveSubtree(PlanLayoutNode& w0, PlanLayoutNode& w1, double shift);
    /// Execute shifts for a layout node
    void ExecuteShifts(PlanLayoutNode& v);
    /// Find the greatest distinct ancestor betweeen nodes
    PlanLayoutNode& FindGreatestDistinctAncestor(PlanLayoutNode& left, PlanLayoutNode& right,
                                                 PlanLayoutNode& default_ancestor);
    /// Perform the second walk over the tree
    void SecondWalk(PlanLayoutNode& child, double m, size_t level = 0);

   public:
    /// Constructor
    PlanLayouter(PlanViewModel& view_model, const PlanViewModel::LayoutConfig& layout_config);
    /// Compute the plan layout
    void Compute();
};

PlanLayouter::PlanLayouter(PlanViewModel& view_model, const PlanViewModel::LayoutConfig& layout_config)
    : view_model(view_model), layout_config(layout_config) {
    nodes.resize(view_model.operators.size());
    for (size_t i = 0; i < view_model.operators.size(); ++i) {
        auto& op = view_model.operators[i];
        nodes[i].parent = op.parent_operator_id.has_value() ? &nodes[op.parent_operator_id.value()] : nullptr;
        nodes[i].children = {nodes.data() + (op.child_operators.data() - view_model.operators.data()),
                             op.child_operators.size()};
        nodes[i].ancestor = &nodes[i];
        // XXX Label
    }
}

void PlanLayouter::FirstWalk(PlanLayoutNode& node, PlanLayoutNode* left_sibling) {
    if (!node.IsLeaf()) {
        // The default ancestor is the left-most child.
        auto* default_ancestor = &node.GetLeftMostChild();
        // Track the left sibling
        PlanLayoutNode* current_left_sibling = nullptr;

        for (auto& child : node.children) {
            assert(default_ancestor != nullptr);
            FirstWalk(child, current_left_sibling);
            default_ancestor = &Apportion(child, current_left_sibling, *default_ancestor);
            current_left_sibling = &child;
        }

        // Execute the shifts at a node
        ExecuteShifts(node);
        // Compute the mid-point
        auto midpoint = (node.GetLeftMostChild().prelim + node.GetRightMostChild().prelim) / 2;

        // Is there a left sibling?
        if (left_sibling) {
            node.prelim = left_sibling->prelim + layout_config.horizontal_separator;
            node.mod = node.prelim - midpoint;
        } else {
            node.prelim = midpoint;
        }
    } else {
        // Is there a left sibling?
        if (left_sibling) {
            node.prelim = left_sibling->prelim + layout_config.horizontal_separator;
        } else {
            node.prelim = 0.0;
        }
    }
}

void PlanLayouter::SecondWalk(PlanLayoutNode& node, double m, size_t level) {
    node.x = node.prelim + m;
    node.y = level * layout_config.vertical_separator;
    for (auto& child : node.children) {
        SecondWalk(child, m + node.mod, level + 1);
    }
}

PlanLayoutNode& PlanLayouter::FindGreatestDistinctAncestor(PlanLayoutNode& left, PlanLayoutNode& right,
                                                           PlanLayoutNode& default_ancestor) {
    assert(left.ancestor != nullptr);
    if (left.ancestor->GetParent() == right.GetParent()) {
        return *left.ancestor;
    } else {
        return default_ancestor;
    }
}

PlanLayoutNode& PlanLayouter::Apportion(PlanLayoutNode& root, PlanLayoutNode* left_sibling_of_root,
                                        PlanLayoutNode& default_ancestor) {
    //
    //     [-]     [+]      o:  Outside contour.
    //      .       .       i:  Inside contour.
    //     / \     / \      ll: Left-tree(s) Left-most-contour.
    //    /___\   /___\     lr: Left-tree(s) Right-most-contour.
    //    o   i   i   o     rl: Right-tree Left-contour.
    //    ll  lr  rl  rr    rr: Right-tree Right-contour.
    //

    auto new_default_ancestor = &default_ancestor;

    if (left_sibling_of_root) {
        PlanLayoutNode* rl = &root;
        PlanLayoutNode* rr = &root;
        PlanLayoutNode* lr = left_sibling_of_root;
        PlanLayoutNode* ll = &rl->GetParent()->GetLeftMostChild();

        double ll_mod = ll->mod;
        double lr_mod = lr->mod;
        double rl_mod = rl->mod;
        double rr_mod = rr->mod;

        // Traverse down the "seam".
        // Left subtree, traverse along right contour.
        // Right subtree, traverse along left contour.
        while (lr->GetNextAlongRightContour() && rl->GetNextAlongLeftContour()) {
            ll = ll->GetNextAlongLeftContour();
            lr = lr->GetNextAlongRightContour();
            rl = rl->GetNextAlongLeftContour();
            rr = rr->GetNextAlongRightContour();

            // Maintain the ancestor of the right contour to be the common root.
            // This allows us to resolve our ancestor in O(1) while going over the tree left-to-right.
            rr->ancestor = &root;

            // Compute the current shift as the difference between the left contour and the right contour along the
            // seam. Section 4 in the Buchheim paper does a good job explain the fractional spacing approach.
            double shift = (lr->prelim + lr_mod) - (rl->prelim + rl_mod) + layout_config.horizontal_separator;

            if (shift > 0) {
                auto& ancestor = FindGreatestDistinctAncestor(*lr, root, default_ancestor);
                MoveSubtree(ancestor, root, shift);
                rl_mod += shift;
                rr_mod += shift;
            }

            ll_mod += ll->mod;
            lr_mod += lr->mod;
            rl_mod += rl->mod;
            rr_mod += rr->mod;
        }

        // Still have contour nodes at the seam from the left subtree?
        if (lr->GetNextAlongRightContour() && !rr->GetNextAlongRightContour()) {
            // Let thread of RR point to LRs right contour starting at next level.
            rr->thread = lr->GetNextAlongRightContour();
            ll->mod += lr_mod - rr_mod;
        }

        // Still have contour nodes at the seam from the right subtree?
        if (rl->GetNextAlongLeftContour() && !ll->GetNextAlongLeftContour()) {
            // Let thread of LL point to RLs left contour starting at next level.
            ll->thread = rl->GetNextAlongLeftContour();
            ll->mod += rl_mod - ll_mod;
            new_default_ancestor = &root;
        }
    }

    return *new_default_ancestor;
}

void PlanLayouter::ExecuteShifts(PlanLayoutNode& v) {
    double shift = 0;
    double change = 0;
    for (auto it = v.children.rbegin(); it != v.children.rend(); ++it) {
        it->prelim += shift;
        it->mod += shift;
        change += it->change;
        shift += it->shift + change;
    }
}

void PlanLayouter::MoveSubtree(PlanLayoutNode& w0, PlanLayoutNode& w1, double shift) {
    // Count the number of subtrees from w0 to w1
    size_t subtrees = 0;
    {
        assert(w0.GetParent() != nullptr);
        assert(w1.GetParent() == w0.GetParent());

        auto end = w0.GetParent()->children.end();
        auto left = end;
        auto right = end;
        for (auto it = w0.GetParent()->children.begin(); it != end; ++it) {
            if (&*it == &w0) {
                left = it;
                for (it = it + 1; it != end; ++it) {
                    if (&*it == &w1) {
                        right = it;  // left < right.
                        break;
                    }
                }
                break;
            }
        }

        assert(left != end);
        assert(right != end);
        subtrees = right - left;
    };

    w1.change -= shift / subtrees;
    w1.shift += shift;
    w0.change += shift / subtrees;
    w1.prelim += shift;
    w1.mod += shift;
}

void PlanLayouter::Compute() {
    for (uint32_t root_op_id : view_model.root_operators) {
        // First run over the tree
        FirstWalk(nodes[root_op_id]);
        // Second run over the tree.
        // `prelim` stores the preliminary x-coordinate AFTER computing the subtree.
        SecondWalk(nodes[root_op_id], -1.0 * nodes[root_op_id].prelim);
    }
}

void PlanViewModel::ComputeLayout(const LayoutConfig& config) {
    // Compute the plan layout
    PlanLayouter layouter{*this, config};
    layouter.Compute();

    // Store the layout positions in the operator
    for (size_t i = 0; i < operators.size(); ++i) {
        auto& in = layouter.nodes[i];
        auto& out = operators[i];
        out.layout_info.emplace(in.x, in.y, 0, 0);
    }
}

}  // namespace dashql
