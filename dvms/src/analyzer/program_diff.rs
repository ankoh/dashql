use super::program_text::*;
use dashql_proto::syntax as sx;

pub type StatementMapping = (usize, usize);
pub type StatementMappings = Vec<StatementMapping>;

pub enum DiffOpCode {
    Delete,
    Insert,
    Keep,
    Move,
    Update,
}

#[derive(PartialEq, Eq)]
pub enum SimilarityEstimate {
    Equal,
    Similar,
    NotEqual,
}

#[derive(Default)]
pub struct StatementSimilarity {
    total_nodes: usize,
    matching_nodes: usize,
}

pub struct DiffOp {
    op_code: DiffOpCode,
    source: Option<usize>,
    target: Option<usize>,
}

pub struct ProgramDiffCtx<'text, 'ast> {
    pub text: &'text str,
    pub ast: sx::Program<'ast>,
    pub subtree_sizes: Vec<usize>,
}

fn compute_tree_size<'text, 'ast>(ctx: &mut ProgramDiffCtx<'text, 'ast>, node_id: usize) -> usize {
    // Init tree sizes
    let nodes = ctx.ast.nodes().unwrap_or_default();
    if ctx.subtree_sizes.len() != nodes.len() {
        ctx.subtree_sizes.resize(nodes.len(), 0);
    } else if ctx.subtree_sizes[node_id] > 0 {
        // Already computed
        return ctx.subtree_sizes[node_id];
    }

    /// Run a DFS starting at every program statement
    #[derive(Clone)]
    struct DFSNode {
        visited: bool,
        target: usize,
        parent: usize,
    }
    let mut pending: Vec<DFSNode> = Vec::new();
    pending.reserve(32);
    pending.push(DFSNode {
        visited: false,
        target: node_id,
        parent: node_id,
    });

    // Traverse the tree
    let mut total = 0;
    while !pending.is_empty() {
        let top = pending.last().unwrap().clone();

        // Already visited?
        if top.visited {
            if pending.len() == 1 {
                total = ctx.subtree_sizes[top.target];
                break;
            }
            ctx.subtree_sizes[top.parent] += ctx.subtree_sizes[top.target];
            pending.pop();
        }

        // Set subtree size and mark as visited
        ctx.subtree_sizes[top.target] = 1;
        pending.last_mut().unwrap().visited = true;

        // Discover children
        let node = nodes[top.target];
        let node_type = node.node_type();
        if node_type.0 > sx::NodeType::OBJECT_KEYS_.0 || node_type == sx::NodeType::ARRAY {
            let children_begin = node.children_begin_or_value();
            let children_count = node.children_count();
            let children_end = children_begin + children_count;
            for i in children_begin..children_end {
                pending.push(DFSNode {
                    visited: false,
                    target: i as usize,
                    parent: top.target,
                });
            }
        }
    }
    total
}

fn estimate_similarity<'source_txt, 'source_ast, 'target_txt, 'target_ast>(
    source: (&ProgramDiffCtx<'_, '_>, usize),
    target: (&ProgramDiffCtx<'_, '_>, usize),
) -> SimilarityEstimate {
    let (source_ctx, source_stmt_id) = source;
    let (target_ctx, target_stmt_id) = target;
    let source_nodes = source_ctx.ast.nodes().unwrap_or_default();
    let target_nodes = target_ctx.ast.nodes().unwrap_or_default();
    let source_stmt = source_ctx.ast.statements().unwrap_or_default().get(source_stmt_id);
    let target_stmt = target_ctx.ast.statements().unwrap_or_default().get(target_stmt_id);

    // Different root node types?
    let s = source_nodes[source_stmt.root_node() as usize];
    let t = target_nodes[target_stmt.root_node() as usize];
    if s.node_type() != t.node_type() {
        return SimilarityEstimate::NotEqual;
    }

    // Do a string comparison if the strings are equal in size and number of root attributes.
    // This will bypass us the tree diffing for all unchanged statements.
    if (s.children_count() == t.children_count()) && (s.location().length() == t.location().length()) {
        let st = text_at(source_ctx.text, *s.location());
        let tt = text_at(target_ctx.text, *t.location());
        if st == tt {
            return SimilarityEstimate::Equal;
        }
    }
    SimilarityEstimate::Similar
}

fn compute_similarity(
    source: (&mut ProgramDiffCtx<'_, '_>, usize),
    target: (&mut ProgramDiffCtx<'_, '_>, usize),
) -> StatementSimilarity {
    // Unpack arguments
    let (source_ctx, source_stmt_id) = source;
    let (target_ctx, target_stmt_id) = target;
    let source_nodes = source_ctx.ast.nodes().unwrap_or_default();
    let target_nodes = target_ctx.ast.nodes().unwrap_or_default();
    let source_stmt = source_ctx.ast.statements().unwrap_or_default().get(source_stmt_id);
    let target_stmt = target_ctx.ast.statements().unwrap_or_default().get(target_stmt_id);

    // Compute tree sizes
    let source_size = compute_tree_size(source_ctx, source_stmt.root_node() as usize);
    let target_size = compute_tree_size(target_ctx, target_stmt.root_node() as usize);
    let node_count = source_size.max(target_size);
    if node_count == 0 {
        return StatementSimilarity::default();
    }

    // Do a DFS traversal starting at the root node
    #[derive(Clone)]
    struct DFSNode {
        visited: bool,
        source_node: usize,
        target_node: usize,
        parent_entry: usize,
        matching_nodes: usize,
    }
    let mut pending: Vec<DFSNode> = Vec::new();
    pending.reserve(32);
    pending.push(DFSNode {
        visited: false,
        source_node: source_stmt.root_node() as usize,
        target_node: target_stmt.root_node() as usize,
        parent_entry: 0,
        matching_nodes: 0,
    });

    // Traverse the tree
    let mut sim = StatementSimilarity::default();
    while !pending.is_empty() {
        let top = pending.last().unwrap().clone();
        let source = source_nodes[top.source_node];
        let target = target_nodes[top.target_node];

        // Already visited?
        if top.visited {
            // Root entry?
            if pending.len() == 1 {
                sim.total_nodes = node_count;
                sim.matching_nodes = top.matching_nodes;
                break;
            }
            pending[top.parent_entry].matching_nodes += top.matching_nodes;
            pending.pop();
            continue;
        }
        pending.last_mut().unwrap().visited = true;
        let pile_idx = pending.len() - 1;

        // Different node type?
        if source.node_type() != target.node_type() {
            continue;
        }

        // Enum of literal
        let is_match = match source.node_type() {
            sx::NodeType::NONE => true,
            sx::NodeType::BOOL | sx::NodeType::UI32 | sx::NodeType::UI32_BITMAP => {
                source.children_begin_or_value() == target.children_begin_or_value()
            }
            sx::NodeType::STRING_REF => {
                text_at(source_ctx.text, *source.location()) == text_at(target_ctx.text, *target.location())
            }
            sx::NodeType::ARRAY => {
                let sb = source.children_begin_or_value();
                let tb = target.children_begin_or_value();
                let sc = source.children_count();
                let tc = target.children_count();
                let c = sc.min(tc);
                for i in 0..c {
                    pending.push(DFSNode {
                        visited: false,
                        source_node: (sb + i) as usize,
                        target_node: (tb + i) as usize,
                        parent_entry: pile_idx,
                        matching_nodes: 0,
                    });
                }
                sc == tc
            }
            node_type => {
                debug_assert!(node_type.0 > sx::NodeType::ENUM_KEYS_.0);
                if node_type.0 > sx::NodeType::OBJECT_KEYS_.0 {
                    // Is object?
                    // Attribute lists are sorted, so a simple merge is enough
                    let sc = source.children_count();
                    let tc = target.children_count();
                    let mut si = source.children_begin_or_value() as usize;
                    let mut ti = target.children_begin_or_value() as usize;
                    let se = si + source.children_count() as usize;
                    let te = ti + target.children_count() as usize;
                    let mut is_match = sc == tc;
                    while (si < se) && (ti < te) {
                        let sk = source_nodes[si].attribute_key();
                        let tk = target_nodes[ti].attribute_key();
                        if sk < tk {
                            si += 1;
                            is_match = false;
                        } else if sk > tk {
                            ti += 1;
                            is_match = false;
                        } else {
                            pending.push(DFSNode {
                                visited: false,
                                source_node: si,
                                target_node: ti,
                                parent_entry: pile_idx,
                                matching_nodes: 0,
                            });
                            si += 1;
                            ti += 1;
                        }
                    }
                    is_match
                } else if node_type.0 > sx::NodeType::ENUM_KEYS_.0 {
                    source.children_begin_or_value() == target.children_begin_or_value()
                } else {
                    false
                }
            }
        };

        // Was a match?
        if is_match {
            pending.last_mut().unwrap().matching_nodes += 1;
        }
    }
    sim
}

fn check_deep_equality(
    source: (&mut ProgramDiffCtx<'_, '_>, usize),
    target: (&mut ProgramDiffCtx<'_, '_>, usize),
) -> bool {
    // Unpack arguments
    let (source_ctx, source_stmt_id) = source;
    let (target_ctx, target_stmt_id) = target;
    let source_nodes = source_ctx.ast.nodes().unwrap_or_default();
    let target_nodes = target_ctx.ast.nodes().unwrap_or_default();
    let source_stmt = source_ctx.ast.statements().unwrap_or_default().get(source_stmt_id);
    let target_stmt = target_ctx.ast.statements().unwrap_or_default().get(target_stmt_id);

    // Compute tree sizes
    let source_size = compute_tree_size(source_ctx, source_stmt.root_node() as usize);
    let target_size = compute_tree_size(target_ctx, target_stmt.root_node() as usize);
    let node_count = source_size.max(target_size);
    if node_count == 0 {
        return true;
    }

    // Do a DFS traversal starting at the root node
    #[derive(Clone)]
    struct DFSNode {
        source_node: usize,
        target_node: usize,
    }
    let mut pending: Vec<DFSNode> = Vec::new();
    pending.reserve(32);
    pending.push(DFSNode {
        source_node: source_stmt.root_node() as usize,
        target_node: target_stmt.root_node() as usize,
    });

    // Traverse the tree
    while !pending.is_empty() {
        let top = pending.last().unwrap().clone();
        let source = source_nodes[top.source_node];
        let target = target_nodes[top.target_node];
        pending.pop();

        // Different node type?
        if source.node_type() != target.node_type() {
            return false;
        }

        // Enum or literal
        let is_equal = match source.node_type() {
            sx::NodeType::NONE => true,
            sx::NodeType::BOOL | sx::NodeType::UI32 | sx::NodeType::UI32_BITMAP => {
                source.children_begin_or_value() == target.children_begin_or_value()
            }
            sx::NodeType::STRING_REF => {
                text_at(source_ctx.text, *source.location()) == text_at(target_ctx.text, *target.location())
            }
            sx::NodeType::ARRAY => {
                let sb = source.children_begin_or_value();
                let tb = target.children_begin_or_value();
                let sc = source.children_count();
                let tc = target.children_count();
                if sc != tc {
                    return false;
                }
                for i in 0..sc {
                    pending.push(DFSNode {
                        source_node: (sb + i) as usize,
                        target_node: (tb + i) as usize,
                    });
                }
                true
            }
            node_type => {
                debug_assert!(node_type.0 > sx::NodeType::ENUM_KEYS_.0);
                if node_type.0 > sx::NodeType::OBJECT_KEYS_.0 {
                    // Is object?
                    // Attribute lists are sorted, so a simple merge is enough
                    let sc = source.children_count();
                    let tc = target.children_count();
                    let mut si = source.children_begin_or_value() as usize;
                    let mut ti = target.children_begin_or_value() as usize;
                    let se = si + source.children_count() as usize;
                    if sc != tc {
                        return false;
                    }
                    while si < se {
                        let sk = source_nodes[si].attribute_key();
                        let tk = target_nodes[ti].attribute_key();
                        if sk != tk {
                            return false;
                        } else {
                            pending.push(DFSNode {
                                source_node: si,
                                target_node: ti,
                            });
                            si += 1;
                            ti += 1;
                        }
                    }
                    true
                } else if node_type.0 > sx::NodeType::ENUM_KEYS_.0 {
                    // Is enum?
                    // Match the value.
                    source.children_begin_or_value() == target.children_begin_or_value()
                } else {
                    true
                }
            }
        };

        // Node differs?
        if !is_equal {
            return false;
        }
    }
    true
}

// Find unique statement pair in two lists of statement ids
fn map_statements(
    source: &mut ProgramDiffCtx<'_, '_>,
    target: &mut ProgramDiffCtx<'_, '_>,
    unique_pairs: &mut StatementMappings,
    equal_pairs: &mut StatementMappings,
) {
    // Maps target ids to matched source ids
    let mut source_ambiguous: Vec<bool> = Vec::new();
    let mut target_ambiguous: Vec<bool> = Vec::new();
    let mut target_mapping: Vec<Option<usize>> = Vec::new();
    let source_stmts = source.ast.statements().unwrap_or_default();
    let target_stmts = target.ast.statements().unwrap_or_default();
    source_ambiguous.resize(source_stmts.len(), false);
    target_ambiguous.resize(target_stmts.len(), false);
    target_mapping.resize(target_stmts.len(), None);

    // We deviate from PatienceDiff sightly here:
    //
    // PatienceDiff first makes both sides unique and then finds mappings between unique records.
    // We assume that our statements are unique most of the time and therefore compute the mapping directly.
    // We also short-circuit the equality checks which makes the quadratic behavior acceptable here.
    //
    for source_id in 0..source_stmts.len() {
        let mut previous_match: Option<usize> = None;
        for target_id in 0..target_stmts.len() {
            let estimate = estimate_similarity((source, source_id), (target, target_id));
            match estimate {
                SimilarityEstimate::NotEqual => continue,
                SimilarityEstimate::Similar => {
                    if !check_deep_equality((source, source_id), (target, target_id)) {
                        continue;
                    }
                }
                SimilarityEstimate::Equal => (),
            }
            equal_pairs.push((source_id, target_id));

            // Mapping ambiguous?
            // Two target statements map to the same source statement
            if let Some(existing) = target_mapping[target_id] {
                source_ambiguous[source_id] = true;
                source_ambiguous[existing] = true;
                target_ambiguous[target_id] = true;
                continue;
            } else if let Some(previous_match) = previous_match {
                // Target statement maps to two source statements
                source_ambiguous[source_id] = true;
                target_ambiguous[previous_match] = true;
                target_ambiguous[target_id] = true;
                continue;
            }
            target_mapping[target_id] = Some(source_id);
            previous_match = Some(target_id);
        }
    }

    // Emit non-ambiguous
    for target_id in 0..target_stmts.len() {
        if let Some(source_id) = target_mapping[target_id] {
            if !source_ambiguous[source_id] && !target_ambiguous[target_id] {
                unique_pairs.push((source_id, target_id));
            }
        }
    }
    unique_pairs.sort_unstable();
}

fn find_lcs(unique_pairs: &StatementMappings) -> StatementMappings {
    let mut lcs = StatementMappings::default();
    struct Entry {
        source_id: usize,
        target_id: usize,
        prev_pile_size: usize,
    }
    type Pile = Vec<Entry>;

    // Build the piles
    let mut piles: Vec<Pile> = Vec::new();
    for (source_id, target_id) in unique_pairs.iter() {
        match piles
            .iter()
            .enumerate()
            .find(|(_, pile)| pile.last().unwrap().target_id >= *target_id)
        {
            Some((pile_id, _)) => {
                let prev_pile_id = pile_id.max(1) - 1;
                let prev_pile_size = piles[prev_pile_id].len();
                piles[pile_id].push(Entry {
                    source_id: *source_id,
                    target_id: *target_id,
                    prev_pile_size,
                });
            }
            None => {
                piles.push(Vec::new());
                let prev_pile_id = piles.len().max(2) - 2;
                let prev_pile_size = piles[prev_pile_id].len();
                piles.last_mut().unwrap().push(Entry {
                    source_id: *source_id,
                    target_id: *target_id,
                    prev_pile_size,
                });
            }
        }
    }

    // No piles?
    if piles.is_empty() {
        return lcs;
    }

    // Build the LCS
    let mut entry_id = piles.last().unwrap().len();
    for pile_id in (0..piles.len()).rev() {
        let entry = &piles[pile_id][entry_id];
        lcs.push((entry.source_id, entry.target_id));
        if pile_id == 0 {
            break;
        }
        debug_assert!(entry.prev_pile_size >= 1);
        entry_id = entry.prev_pile_size - 1;
    }
    lcs.reverse();
    lcs
}

pub fn compute_diff(source: &mut ProgramDiffCtx<'_, '_>, target: &mut ProgramDiffCtx<'_, '_>) -> Vec<DiffOp> {
    // Unpack arguments
    let source_stmts = source.ast.statements().unwrap_or_default();
    let target_stmts = target.ast.statements().unwrap_or_default();

    // Find statement mappings
    let mut unique_pairs = Vec::new();
    let mut equal_pairs = Vec::new();
    map_statements(source, target, &mut unique_pairs, &mut equal_pairs);

    // Build the LCS
    let lcs = find_lcs(&unique_pairs);

    // Track which statements were emitted
    let mut source_emitted = Vec::new();
    let mut target_emitted = Vec::new();
    source_emitted.resize(source_stmts.len(), false);
    target_emitted.resize(target_stmts.len(), false);

    // Helper to emit diff ops
    let mut ops = Vec::new();
    let emit = &mut |code: DiffOpCode, source_id: Option<usize>, target_id: Option<usize>| {
        ops.push(DiffOp {
            op_code: code,
            source: source_id,
            target: target_id,
        });
        if let Some(source_id) = source_id {
            source_emitted[source_id] = true;
        }
        if let Some(target_id) = target_id {
            target_emitted[target_id] = true;
        }
    };

    // Iterate over LCS sections
    let mut prev = (0, 0);
    let mut next = (0, 0);
    let mut lcs_iter = 0;
    lcs_iter -= 1;

    loop {
        // Find next mapping range
        lcs_iter += 1;
        prev = next;
        next = if lcs_iter < lcs.len() {
            lcs[lcs_iter]
        } else {
            (source_stmts.len(), target_stmts.len())
        };
        let (prev_source_id, prev_target_id) = prev;
        let (next_source_id, next_target_id) = next;

        // Iterate over all source statements in the section
        for source_id in prev_source_id..next_source_id {
            // Are the equal pairs?
            // We have to emit equal pairs that are either ambiguous or unique but cross section boundaries.
            // XXX
        }
    }

    Vec::new()
}
