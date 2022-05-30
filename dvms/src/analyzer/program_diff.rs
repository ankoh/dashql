use super::program_instance::ProgramInstance;
use dashql_proto::syntax as sx;
use std::collections::BinaryHeap;

// The fraction of nodes that must be equal between statements to emit an UPDATE.
// (Instead of DELETE + INSERT)
const UPDATE_SIMILARITY_THRESHOLD: f64 = 0.75;

type StatementMapping = (usize, usize);
type StatementMappings = Vec<StatementMapping>;

#[derive(PartialEq, Eq)]
enum SimilarityEstimate {
    Equal,
    Similar,
    NotEqual,
}

#[derive(Default)]
struct StatementSimilarity {
    total_nodes: usize,
    matching_nodes: usize,
}

impl StatementSimilarity {
    fn score(&self) -> f64 {
        if self.total_nodes == 0 {
            0.0
        } else {
            self.matching_nodes as f64 / self.total_nodes as f64
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum DiffOpCode {
    Delete,
    Insert,
    Keep,
    Move,
    Update,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct DiffOp {
    pub op_code: DiffOpCode,
    pub source: Option<usize>,
    pub target: Option<usize>,
}

fn compute_tree_size<'a>(ctx: &ProgramInstance<'a>, node_id: usize) -> usize {
    // Init tree sizes
    let nodes = ctx.program_proto.nodes().unwrap_or_default();
    let mut cached_subtree_sizes = ctx.cached_subtree_sizes.borrow_mut();
    if cached_subtree_sizes.len() != nodes.len() {
        cached_subtree_sizes.resize(nodes.len(), 0);
    } else if cached_subtree_sizes[node_id] > 0 {
        // Already computed
        return cached_subtree_sizes[node_id];
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
                total = cached_subtree_sizes[top.target];
                break;
            }
            cached_subtree_sizes[top.parent] += cached_subtree_sizes[top.target];
            pending.pop();
        }

        // Set subtree size and mark as visited
        cached_subtree_sizes[top.target] = 1;
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

fn text_at<'text>(text: &'text str, loc: sx::Location) -> &'text str {
    &text[loc.offset() as usize..(loc.offset() + loc.length()) as usize]
}

fn estimate_similarity(
    source: (&ProgramInstance<'_>, usize),
    target: (&ProgramInstance<'_>, usize),
) -> SimilarityEstimate {
    let (source_ctx, source_stmt_id) = source;
    let (target_ctx, target_stmt_id) = target;
    let source_nodes = source_ctx.program_proto.nodes().unwrap_or_default();
    let target_nodes = target_ctx.program_proto.nodes().unwrap_or_default();
    let source_stmt = source_ctx
        .program_proto
        .statements()
        .unwrap_or_default()
        .get(source_stmt_id);
    let target_stmt = target_ctx
        .program_proto
        .statements()
        .unwrap_or_default()
        .get(target_stmt_id);

    // Different root node types?
    let s = source_nodes[source_stmt.root_node() as usize];
    let t = target_nodes[target_stmt.root_node() as usize];
    if s.node_type() != t.node_type() {
        return SimilarityEstimate::NotEqual;
    }

    // Do a string comparison if the strings are equal in size and number of root attributes.
    // This will bypass us the tree diffing for all unchanged statements.
    if (s.children_count() == t.children_count()) && (s.location().length() == t.location().length()) {
        let st = text_at(source_ctx.script_text, *s.location());
        let tt = text_at(target_ctx.script_text, *t.location());
        if st == tt {
            return SimilarityEstimate::Equal;
        }
    }
    SimilarityEstimate::Similar
}

fn compute_similarity(
    source: (&ProgramInstance<'_>, usize),
    target: (&ProgramInstance<'_>, usize),
) -> StatementSimilarity {
    // Unpack arguments
    let (source_ctx, source_stmt_id) = source;
    let (target_ctx, target_stmt_id) = target;
    let source_nodes = source_ctx.program_proto.nodes().unwrap_or_default();
    let target_nodes = target_ctx.program_proto.nodes().unwrap_or_default();
    let source_stmt = source_ctx
        .program_proto
        .statements()
        .unwrap_or_default()
        .get(source_stmt_id);
    let target_stmt = target_ctx
        .program_proto
        .statements()
        .unwrap_or_default()
        .get(target_stmt_id);

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
                text_at(source_ctx.script_text, *source.location())
                    == text_at(target_ctx.script_text, *target.location())
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

fn check_deep_equality(source: (&ProgramInstance<'_>, usize), target: (&ProgramInstance<'_>, usize)) -> bool {
    // Unpack arguments
    let (source_ctx, source_stmt_id) = source;
    let (target_ctx, target_stmt_id) = target;
    let source_nodes = source_ctx.program_proto.nodes().unwrap_or_default();
    let target_nodes = target_ctx.program_proto.nodes().unwrap_or_default();
    let source_stmt = source_ctx
        .program_proto
        .statements()
        .unwrap_or_default()
        .get(source_stmt_id);
    let target_stmt = target_ctx
        .program_proto
        .statements()
        .unwrap_or_default()
        .get(target_stmt_id);

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
                text_at(source_ctx.script_text, *source.location())
                    == text_at(target_ctx.script_text, *target.location())
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
    source: &ProgramInstance<'_>,
    target: &ProgramInstance<'_>,
    unique_pairs: &mut StatementMappings,
    equal_pairs: &mut StatementMappings,
) {
    // Maps target ids to matched source ids
    let mut source_ambiguous: Vec<bool> = Vec::new();
    let mut target_ambiguous: Vec<bool> = Vec::new();
    let mut target_mapping: Vec<Option<usize>> = Vec::new();
    let source_stmts = source.program_proto.statements().unwrap_or_default();
    let target_stmts = target.program_proto.statements().unwrap_or_default();
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
    #[derive(Debug)]
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
    let mut entry_id = piles.last().unwrap().len() - 1;
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

#[derive(Eq, PartialEq)]
struct SimilarityScoreEntry {
    entry_id: usize,
    score: u64,
}

impl std::cmp::PartialOrd for SimilarityScoreEntry {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        self.score.partial_cmp(&other.score)
    }
}

impl std::cmp::Ord for SimilarityScoreEntry {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.score.cmp(&other.score)
    }
}

pub fn compute_diff(source: &ProgramInstance<'_>, target: &ProgramInstance<'_>) -> Vec<DiffOp> {
    // Unpack arguments
    let source_stmts = source.program_proto.statements().unwrap_or_default();
    let target_stmts = target.program_proto.statements().unwrap_or_default();
    let mut source_emitted = Vec::new();
    let mut target_emitted = Vec::new();
    source_emitted.resize(source_stmts.len(), false);
    target_emitted.resize(target_stmts.len(), false);

    // Find statement mappings
    let mut unique_pairs = Vec::new();
    let mut equal_pairs = Vec::new();
    map_statements(source, target, &mut unique_pairs, &mut equal_pairs);

    // Build the LCS
    let lcs = find_lcs(&unique_pairs);

    // Derive diff ops
    let mut ops = Vec::new();
    let mut prev: (usize, usize);
    let mut next = (0, 0);
    let mut next_lcs = 0;
    while next_lcs <= lcs.len() {
        // Find next mapping range
        prev = next;
        next = if next_lcs < lcs.len() {
            lcs[next_lcs as usize]
        } else {
            (source_stmts.len(), target_stmts.len())
        };
        next_lcs += 1;
        let (prev_source_id, prev_target_id) = prev;
        let (next_source_id, next_target_id) = next;

        // Emit diff operation for unique upper bound in lcs
        if next != (source_stmts.len(), target_stmts.len()) {
            ops.push(DiffOp {
                op_code: DiffOpCode::Keep,
                source: Some(next_source_id),
                target: Some(next_target_id),
            });
            source_emitted[next_source_id] = true;
            target_emitted[next_target_id] = true;
        }

        // Iterate over all source statements between lower and upper bound
        for source_id in prev_source_id..next_source_id {
            if source_emitted[source_id] {
                continue;
            }
            // Are there equal pairs?
            // We have to emit equal pairs that are either ambiguous or unique but cross section boundaries.
            let equal_begin = equal_pairs.partition_point(|(source, _)| *source < source_id);
            let equal_end = equal_pairs.partition_point(|(source, _)| *source <= source_id);
            for equal_iter in equal_begin..equal_end {
                let (_, target_id) = equal_pairs[equal_iter];
                if target_emitted[target_id] {
                    continue;
                }
                ops.push(DiffOp {
                    op_code: DiffOpCode::Move,
                    source: Some(source_id),
                    target: Some(target_id),
                });
                source_emitted[source_id] = true;
                target_emitted[target_id] = true;
                break;
            }
            if source_emitted[source_id] {
                continue;
            }

            // Find best match among the remaining targets in the section.
            // This will result in a FCFS assignment of updated statements.
            // We could model this as bi-partite weighted matching problem but it's probably not worth it.
            // FCFS might be the more intuitive mapping anyway.
            let mut matches = BinaryHeap::new();
            for target_id in prev_target_id..next_target_id {
                if target_emitted[target_id] {
                    continue;
                }
                // The similiarity computation of unmatched statements is the most expensive operation in this diff.
                // We want to do it as rarely as possible and therefore do an additional fast estimation upfront.
                match estimate_similarity((source, source_id), (target, target_id)) {
                    SimilarityEstimate::NotEqual => continue,
                    SimilarityEstimate::Equal => {
                        ops.push(DiffOp {
                            op_code: DiffOpCode::Keep,
                            source: Some(source_id),
                            target: Some(target_id),
                        });
                        target_emitted[target_id] = true;
                        break;
                    }
                    SimilarityEstimate::Similar => {
                        let sim = compute_similarity((source, source_id), (target, target_id));
                        let sim_score = sim.score();
                        // Qualifies as similar statement?
                        // Add to min-heap
                        if sim_score >= UPDATE_SIMILARITY_THRESHOLD {
                            matches.push(SimilarityScoreEntry {
                                entry_id: target_id,
                                score: (sim_score * 1000000000.0) as u64,
                            });
                        }
                    }
                }
            }

            // Found nothing?
            match matches.pop() {
                Some(m) => {
                    target_emitted[m.entry_id] = true;
                    ops.push(DiffOp {
                        op_code: DiffOpCode::Update,
                        source: Some(source_id),
                        target: Some(m.entry_id),
                    });
                }
                None => {
                    ops.push(DiffOp {
                        op_code: DiffOpCode::Delete,
                        source: Some(source_id),
                        target: None,
                    });
                }
            }
        }

        // Create new statements
        for target_id in prev_target_id..next_target_id {
            if target_emitted[target_id] {
                continue;
            }
            ops.push(DiffOp {
                op_code: DiffOpCode::Insert,
                source: None,
                target: Some(target_id),
            });
        }
    }
    // Sort by the source id
    ops.sort_unstable_by(|l, r| match (l.source, r.source) {
        (None, None) => std::cmp::Ordering::Less,
        (None, _) => std::cmp::Ordering::Greater,
        (_, None) => std::cmp::Ordering::Less,
        (Some(a), Some(b)) => a.cmp(&b),
    });
    ops
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::analyzer::analysis_settings::ProgramAnalysisSettings;
    use crate::grammar;
    use std::collections::HashMap;
    use std::error::Error;
    use std::rc::Rc;

    // Test a difference
    fn test_diff(
        script0: &'static str,
        script1: &'static str,
        expected: &[DiffOp],
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let settings = Rc::new(ProgramAnalysisSettings::default());
        let arena = bumpalo::Bump::new();
        let ast0 = grammar::parse(&arena, script0)?;
        let ast1 = grammar::parse(&arena, script1)?;
        let prog0 = Rc::new(grammar::deserialize_ast(&arena, script0, ast0).unwrap());
        let prog1 = Rc::new(grammar::deserialize_ast(&arena, script1, ast1).unwrap());
        let mut ctx0 = ProgramInstance::new(settings.clone(), &arena, script0, ast0, prog0, HashMap::new());
        let mut ctx1 = ProgramInstance::new(settings, &arena, script1, ast1, prog1, HashMap::new());
        let diff = compute_diff(&mut ctx0, &mut ctx1);
        assert_eq!(diff, expected);
        Ok(())
    }

    #[test]
    fn test_diff_equal_0() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_diff(
            "SELECT 1",
            "SELECT 1",
            &[DiffOp {
                op_code: DiffOpCode::Keep,
                source: Some(0),
                target: Some(0),
            }],
        )?;
        Ok(())
    }

    #[test]
    fn test_diff_delete_0() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_diff(
            r#"SELECT 1; SELECT 42;"#,
            r#"SELECT 1;"#,
            &[
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(0),
                    target: Some(0),
                },
                DiffOp {
                    op_code: DiffOpCode::Delete,
                    source: Some(1),
                    target: None,
                },
            ],
        )?;
        Ok(())
    }

    #[test]
    fn test_diff_insert_0() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_diff(
            r#"SELECT 1;"#,
            r#"SELECT 1;SELECT 42;"#,
            &[
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(0),
                    target: Some(0),
                },
                DiffOp {
                    op_code: DiffOpCode::Insert,
                    source: None,
                    target: Some(1),
                },
            ],
        )?;
        Ok(())
    }

    #[test]
    fn test_diff_insert_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_diff(
            r#"SELECT 1;"#,
            r#"SELECT 42;SELECT 1;"#,
            &[
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(0),
                    target: Some(1),
                },
                DiffOp {
                    op_code: DiffOpCode::Insert,
                    source: None,
                    target: Some(0),
                },
            ],
        )?;
        Ok(())
    }

    #[test]
    fn test_diff_move_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_diff(
            r#"SELECT 1;SELECT 2;SELECT 3;"#,
            r#"SELECT 1;SELECT 3;SELECT 2;"#,
            &[
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(0),
                    target: Some(0),
                },
                DiffOp {
                    op_code: DiffOpCode::Move,
                    source: Some(1),
                    target: Some(2),
                },
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(2),
                    target: Some(1),
                },
            ],
        )?;
        Ok(())
    }

    #[test]
    fn test_diff_script_0() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_diff(
            r#"
LOAD weather FROM weather_csv USING CSV;
SELECT 4;
SELECT 2 INTO weather_avg FROM weather;
VIZ weather_avg USING LINE;
"#,
            r#"
LOAD weather FROM weather_csv USING CSV;
SELECT 1 INTO weather_avg FROM weather;
VIZ weather_avg USING LINE;
VIZ weather_avg_2 USING BAR;
"#,
            &[
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(0),
                    target: Some(0),
                },
                DiffOp {
                    op_code: DiffOpCode::Delete,
                    source: Some(1),
                    target: None,
                },
                DiffOp {
                    op_code: DiffOpCode::Update,
                    source: Some(2),
                    target: Some(1),
                },
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(3),
                    target: Some(2),
                },
                DiffOp {
                    op_code: DiffOpCode::Insert,
                    source: None,
                    target: Some(3),
                },
            ],
        )?;
        Ok(())
    }

    #[test]
    fn test_diff_script_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_diff(
            r#"
LOAD weather FROM weather_csv USING CSV;
SELECT 4;
SELECT 2 INTO weather_avg FROM weather;
VIZ weather_avg USING LINE;
"#,
            r#"
LOAD weather FROM weather_csv USING CSV;
SELECT 1 INTO weather_avg FROM weather;
VIZ weather_avg USING LINE;
"#,
            &[
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(0),
                    target: Some(0),
                },
                DiffOp {
                    op_code: DiffOpCode::Delete,
                    source: Some(1),
                    target: None,
                },
                DiffOp {
                    op_code: DiffOpCode::Update,
                    source: Some(2),
                    target: Some(1),
                },
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(3),
                    target: Some(2),
                },
            ],
        )?;
        Ok(())
    }

    #[test]
    fn test_diff_script_2() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_diff(
            r#"
LOAD weather FROM weather_csv USING CSV;
SELECT 2 INTO weather_avg FROM weather;
SELECT 4;
VIZ weather_avg USING LINE;
"#,
            r#"
LOAD weather FROM weather_csv USING CSV;
VIZ weather_avg USING LINE;
"#,
            &[
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(0),
                    target: Some(0),
                },
                DiffOp {
                    op_code: DiffOpCode::Delete,
                    source: Some(1),
                    target: None,
                },
                DiffOp {
                    op_code: DiffOpCode::Delete,
                    source: Some(2),
                    target: None,
                },
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(3),
                    target: Some(1),
                },
            ],
        )?;
        Ok(())
    }

    #[test]
    fn test_diff_script_3() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_diff(
            r#"
LOAD weather FROM weather_csv USING CSV;
SELECT 1 INTO weather_avg FROM weather;
VIZ weather_avg USING LINE;
"#,
            r#"
LOAD weather FROM weather_csv USING CSV;
SELECT 2 INTO weather_avg FROM weather;
VIZ weather_avg USING LINE;
"#,
            &[
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(0),
                    target: Some(0),
                },
                DiffOp {
                    op_code: DiffOpCode::Update,
                    source: Some(1),
                    target: Some(1),
                },
                DiffOp {
                    op_code: DiffOpCode::Keep,
                    source: Some(2),
                    target: Some(2),
                },
            ],
        )?;
        Ok(())
    }
}
