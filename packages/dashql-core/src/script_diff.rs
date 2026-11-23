//! A statement-level semantic diff between two parsed scripts.
//!
//! A modified patience diff over the statements of two parsed scripts: statements are mapped by
//! structural equality (order-insensitive), the longest common subsequence of unambiguous pairs is
//! kept, and the remaining statements are classified as MOVE / UPDATE / DELETE / INSERT.
//!
//! AST spans are token-index based and are resolved through the scanned script before touching
//! text. Object attribute lists are not sorted by key, the traversals sort a scratch copy.

use dashql_buffers::diff::{ScriptDiffOpCode, ScriptDiffOpT, ScriptDiffT};
use dashql_buffers::parser::{Node, NodeType, TextSpanT};
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::{ParsedScript, Statement};
use dashql_parser::span::TextSpan;

/// The fraction of nodes that must be equal between statements to emit an UPDATE (instead of
/// DELETE + INSERT)
const UPDATE_SIMILARITY_THRESHOLD: f64 = 0.75;

/// A single diff operation
#[derive(Clone, Debug, PartialEq)]
pub struct DiffOp {
    /// The operation: MOVE, UPDATE, DELETE, INSERT or KEEP
    pub code: ScriptDiffOpCode,
    /// The source (old) statement index, None for INSERT
    pub source_statement: Option<u32>,
    /// The target (new) statement index, None for DELETE
    pub target_statement: Option<u32>,
    /// The resolved text span of the source statement root (empty if no source)
    pub source_span: TextSpan,
    /// The resolved text span of the target statement root (empty if no target)
    pub target_span: TextSpan,
    /// The changed sub-ranges within the target statement (UPDATE only, coalesced)
    pub target_changes: Vec<TextSpan>,
}

/// A fast similarity estimate for two statements
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SimilarityEstimate {
    NotEqual,
    Similar,
    Equal,
}

/// A statement similarity score (matching nodes / total nodes)
#[derive(Clone, Copy, Debug, Default)]
struct StatementSimilarity {
    /// The number of nodes that match in both statements
    matching_nodes: usize,
    /// The node count of the larger statement
    total_nodes: usize,
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

/// A statement mapping (source id, target id)
type StatementMapping = (usize, usize);

/// The matched target statement and operation of every source statement, by source statement index
type SourceMatches = Vec<Option<(ScriptDiffOpCode, usize)>>;

/// Match a source statement with a target statement
fn claim(
    source_match: &mut SourceMatches,
    target_matched: &mut [bool],
    code: ScriptDiffOpCode,
    source_id: usize,
    target_id: usize,
) {
    if let Some(m) = source_match.get_mut(source_id) {
        *m = Some((code, target_id));
    }
    flag(target_matched, target_id);
}

/// Is a source statement still unmatched?
fn unmatched(source_match: &SourceMatches, source_id: usize) -> bool {
    source_match.get(source_id).is_some_and(Option::is_none)
}

/// Is the node type an enum? Enums live between ENUM_KEYS_ and OBJECT_KEYS_.
fn is_enum_type(t: NodeType) -> bool {
    let id = t.0;
    id > NodeType::ENUM_KEYS_.0 && id < NodeType::OBJECT_KEYS_.0
}

/// Is the node type an object? Objects live above OBJECT_KEYS_.
fn is_object_type(t: NodeType) -> bool {
    t.0 > NodeType::OBJECT_KEYS_.0
}

/// Does the node type have child nodes (as opposed to an inline value)?
fn has_children(t: NodeType) -> bool {
    t == NodeType::ARRAY || is_object_type(t)
}

fn key_id(n: &Node) -> u16 {
    n.attribute_key().0
}

/// The text of a span, read as if the text were followed by two padding NUL bytes. Spans of EOF errors
/// end one byte past the text (see docs/design/core_quirks.md).
fn padded_text(script: &ParsedScript, span: TextSpan) -> std::borrow::Cow<'_, [u8]> {
    let text = script.scanned.text.as_bytes();
    let begin = (span.offset as usize).min(text.len() + 2);
    let end = (span.end() as usize).min(text.len() + 2);
    if end <= text.len() {
        return std::borrow::Cow::Borrowed(text.get(begin..end).unwrap_or_default());
    }
    let mut out = text.get(begin.min(text.len())..).unwrap_or_default().to_vec();
    out.resize(end - begin, 0);
    std::borrow::Cow::Owned(out)
}

/// The resolved text of a node (for operators and literals)
fn node_text<'a>(script: &'a ParsedScript, node: &Node) -> std::borrow::Cow<'a, [u8]> {
    padded_text(script, resolve(script, node))
}

/// The registered name text of a NAME node
fn name_text<'a>(script: &'a ParsedScript, node: &Node) -> &'a str {
    &script.scanned.names.get(node.children_begin_or_value()).text
}

fn resolve(script: &ParsedScript, node: &Node) -> TextSpan {
    resolve_text_span(&script.scanned.text, &script.scanned.symbols, *node.symbol_span())
}

/// The text span of a statement root (empty if the root is invalid)
fn resolve_statement_span(script: &ParsedScript, statement: &Statement) -> TextSpan {
    match script.nodes.get(statement.root as usize) {
        Some(root) => resolve(script, root),
        None => TextSpan::default(),
    }
}

/// An object's child nodes as (attribute key, node index), sorted (stably) by attribute key
fn collect_sorted_children(script: &ParsedScript, node: &Node, out: &mut Vec<(u16, u32)>) {
    out.clear();
    let begin = node.children_begin_or_value();
    out.extend(script.children(node).iter().zip(begin..).map(|(child, i)| (key_id(child), i)));
    out.sort_by_key(|&(key, _)| key);
}

/// Is a statement flagged? An index outside of the flags counts as flagged, there is nothing to emit for it.
fn flagged(flags: &[bool], index: usize) -> bool {
    flags.get(index).copied().unwrap_or(true)
}

/// Flag a statement
fn flag(flags: &mut [bool], index: usize) {
    if let Some(flag) = flags.get_mut(index) {
        *flag = true;
    }
}

/// The diff between two parsed scripts
pub struct ScriptDiff<'a> {
    /// The source (old) script
    source: &'a ParsedScript,
    /// The target (new) script
    target: &'a ParsedScript,
    /// Memoized subtree sizes (0 = not computed yet)
    source_subtree_sizes: Vec<usize>,
    /// Memoized subtree sizes of the target (0 = not computed yet)
    target_subtree_sizes: Vec<usize>,
    /// The computed operations
    ops: Vec<DiffOp>,
    /// Whether the operations were computed
    computed: bool,
}

impl<'a> ScriptDiff<'a> {
    pub fn new(source: &'a ParsedScript, target: &'a ParsedScript) -> Self {
        Self {
            source,
            target,
            source_subtree_sizes: Vec::new(),
            target_subtree_sizes: Vec::new(),
            ops: Vec::new(),
            computed: false,
        }
    }

    /// The size of the subtree rooted at `root` (memoized iterative DFS)
    fn compute_tree_size(script: &ParsedScript, root: usize, sizes: &mut Vec<usize>) -> usize {
        if root >= script.nodes.len() {
            return 0;
        }
        if sizes.len() != script.nodes.len() {
            *sizes = vec![0; script.nodes.len()];
        } else if let Some(&size) = sizes.get(root).filter(|&&size| size > 0) {
            return size;
        }
        // (node, parent, visited)
        let mut pending: Vec<(usize, usize, bool)> = Vec::with_capacity(32);
        pending.push((root, root, false));
        let mut node_count = 0;
        while let Some(&(node_id, parent, visited)) = pending.last() {
            if visited {
                let size = sizes.get(node_id).copied().unwrap_or(0);
                if pending.len() == 1 {
                    node_count = size;
                    break;
                }
                if let Some(parent_size) = sizes.get_mut(parent) {
                    *parent_size += size;
                }
                pending.pop();
                continue;
            }
            if let Some(last) = pending.last_mut() {
                last.2 = true;
            }
            // A child outside of the AST counts as no node, `sizes` is as long as the AST
            let (Some(size), Some(node)) = (sizes.get_mut(node_id), script.nodes.get(node_id)) else { continue };
            *size = 1;
            if has_children(node.node_type()) {
                let begin = node.children_begin_or_value() as usize;
                for i in begin..begin + node.children_count() as usize {
                    pending.push((i, node_id, false));
                }
            }
        }
        node_count
    }

    /// Estimate the similarity of two statements (O(1) for unchanged statements)
    fn estimate_similarity(&self, source: &Statement, target: &Statement) -> SimilarityEstimate {
        let (Some(s), Some(t)) =
            (self.source.nodes.get(source.root as usize), self.target.nodes.get(target.root as usize))
        else {
            return SimilarityEstimate::NotEqual;
        };
        if s.node_type() != t.node_type() {
            return SimilarityEstimate::NotEqual;
        }
        // Compare the text if the statements are equal in size and number of root attributes.
        let s_span = resolve(self.source, s);
        let t_span = resolve(self.target, t);
        if s.children_count() == t.children_count() && s_span.length == t_span.length {
            if padded_text(self.source, s_span) == padded_text(self.target, t_span) {
                return SimilarityEstimate::Equal;
            }
        }
        SimilarityEstimate::Similar
    }

    /// Do two nodes of the same type match without looking at their children?
    fn leaf_match(&self, s: &Node, t: &Node) -> Option<bool> {
        Some(match s.node_type() {
            NodeType::NONE => true,
            NodeType::BOOL => s.children_begin_or_value() == t.children_begin_or_value(),
            NodeType::NAME => name_text(self.source, s) == name_text(self.target, t),
            NodeType::OPERATOR
            | NodeType::LITERAL_NULL
            | NodeType::LITERAL_INTEGER
            | NodeType::LITERAL_FLOAT
            | NodeType::LITERAL_STRING
            | NodeType::LITERAL_INTERVAL => node_text(self.source, s) == node_text(self.target, t),
            _ => return None,
        })
    }

    /// Compute the similarity of two statements (lockstep DFS over the subtrees)
    fn compute_similarity(&mut self, source: &Statement, target: &Statement) -> StatementSimilarity {
        let source_size = Self::compute_tree_size(self.source, source.root as usize, &mut self.source_subtree_sizes);
        let target_size = Self::compute_tree_size(self.target, target.root as usize, &mut self.target_subtree_sizes);
        let node_count = source_size.max(target_size);
        if node_count == 0 {
            return StatementSimilarity::default();
        }
        /// A pair of nodes on the stack of the lockstep DFS
        struct Entry {
            /// The node in the source script
            source_node: usize,
            /// The node in the target script
            target_node: usize,
            /// The stack index of the parent entry
            parent_entry: usize,
            /// The number of matching nodes in the subtree
            matching_nodes: usize,
            /// Whether the children were pushed
            visited: bool,
        }
        let mut pending = Vec::with_capacity(32);
        pending.push(Entry {
            source_node: source.root as usize,
            target_node: target.root as usize,
            parent_entry: 0,
            matching_nodes: 0,
            visited: false,
        });
        let mut src_children = Vec::new();
        let mut tgt_children = Vec::new();
        let mut sim = StatementSimilarity::default();
        loop {
            let idx = pending.len().wrapping_sub(1);
            let Some(entry) = pending.last_mut() else { break };
            if entry.visited {
                if idx == 0 {
                    sim.total_nodes = node_count;
                    sim.matching_nodes = entry.matching_nodes;
                    break;
                }
                let Some(entry) = pending.pop() else { break };
                if let Some(parent) = pending.get_mut(entry.parent_entry) {
                    parent.matching_nodes += entry.matching_nodes;
                }
                continue;
            }
            entry.visited = true;
            // A pair outside of the AST doesn't match
            let (Some(&s), Some(&t)) =
                (self.source.nodes.get(entry.source_node), self.target.nodes.get(entry.target_node))
            else {
                continue;
            };
            let mut matched = true;
            if s.node_type() != t.node_type() {
                matched = false;
            } else if let Some(m) = self.leaf_match(&s, &t) {
                matched = m;
            } else if s.node_type() == NodeType::ARRAY {
                let (sc, tc) = (s.children_count(), t.children_count());
                matched = sc == tc;
                let (sb, tb) = (s.children_begin_or_value(), t.children_begin_or_value());
                for i in 0..sc.min(tc) {
                    pending.push(Entry {
                        source_node: (sb + i) as usize,
                        target_node: (tb + i) as usize,
                        parent_entry: idx,
                        matching_nodes: 0,
                        visited: false,
                    });
                }
            } else if is_object_type(s.node_type()) {
                // Attribute lists are unsorted; sort scratch copies by key, then merge-join.
                collect_sorted_children(self.source, &s, &mut src_children);
                collect_sorted_children(self.target, &t, &mut tgt_children);
                matched = s.children_count() == t.children_count();
                let (mut i, mut j) = (0, 0);
                while let (Some(&(sk, si)), Some(&(tk, ti))) = (src_children.get(i), tgt_children.get(j)) {
                    if sk < tk {
                        i += 1;
                        matched = false;
                    } else if sk > tk {
                        j += 1;
                        matched = false;
                    } else {
                        pending.push(Entry {
                            source_node: si as usize,
                            target_node: ti as usize,
                            parent_entry: idx,
                            matching_nodes: 0,
                            visited: false,
                        });
                        i += 1;
                        j += 1;
                    }
                }
            } else if is_enum_type(s.node_type()) {
                matched = s.children_begin_or_value() == t.children_begin_or_value();
            }
            if matched {
                if let Some(entry) = pending.get_mut(idx) {
                    entry.matching_nodes += 1;
                }
            }
        }
        sim
    }

    /// Check two statements for deep equality
    fn check_deep_equality(&self, source: &Statement, target: &Statement) -> bool {
        let source_valid = (source.root as usize) < self.source.nodes.len();
        let target_valid = (target.root as usize) < self.target.nodes.len();
        if !source_valid || !target_valid {
            return !source_valid && !target_valid;
        }
        let mut pending = vec![(source.root as usize, target.root as usize)];
        let mut src_children = Vec::new();
        let mut tgt_children = Vec::new();
        while let Some((source_id, target_id)) = pending.pop() {
            // A pair outside of the AST is not equal
            let (Some(&s), Some(&t)) = (self.source.nodes.get(source_id), self.target.nodes.get(target_id)) else {
                return false;
            };
            if s.node_type() != t.node_type() {
                return false;
            }
            if let Some(m) = self.leaf_match(&s, &t) {
                if !m {
                    return false;
                }
            } else if s.node_type() == NodeType::ARRAY {
                if s.children_count() != t.children_count() {
                    return false;
                }
                let (sb, tb) = (s.children_begin_or_value(), t.children_begin_or_value());
                for i in 0..s.children_count() {
                    pending.push(((sb + i) as usize, (tb + i) as usize));
                }
            } else if is_object_type(s.node_type()) {
                if s.children_count() != t.children_count() {
                    return false;
                }
                collect_sorted_children(self.source, &s, &mut src_children);
                collect_sorted_children(self.target, &t, &mut tgt_children);
                for (&(sk, si), &(tk, ti)) in src_children.iter().zip(&tgt_children) {
                    if sk != tk {
                        return false;
                    }
                    pending.push((si as usize, ti as usize));
                }
            } else if is_enum_type(s.node_type()) && s.children_begin_or_value() != t.children_begin_or_value() {
                return false;
            }
        }
        true
    }

    /// Map statements between the two scripts (unique + equal pairs, with ambiguity handling)
    fn map_statements(&self) -> (Vec<StatementMapping>, Vec<StatementMapping>) {
        let source_count = self.source.statements.len();
        let target_count = self.target.statements.len();
        let mut source_ambiguous = vec![false; source_count];
        let mut target_ambiguous = vec![false; target_count];
        let mut target_mapping: Vec<Option<usize>> = vec![None; target_count];
        let mut unique_pairs = Vec::new();
        let mut equal_pairs = Vec::new();

        for (source_id, source_stmt) in self.source.statements.iter().enumerate() {
            let mut matched: Option<usize> = None;
            for (target_id, target_stmt) in self.target.statements.iter().enumerate() {
                let equal = match self.estimate_similarity(source_stmt, target_stmt) {
                    SimilarityEstimate::NotEqual => false,
                    SimilarityEstimate::Similar => self.check_deep_equality(source_stmt, target_stmt),
                    SimilarityEstimate::Equal => true,
                };
                if !equal {
                    continue;
                }
                equal_pairs.push((source_id, target_id));
                let Some(mapping) = target_mapping.get_mut(target_id) else { continue };
                if let Some(existing) = *mapping {
                    // Two source statements map to the same target statement
                    flag(&mut source_ambiguous, source_id);
                    flag(&mut source_ambiguous, existing);
                    flag(&mut target_ambiguous, target_id);
                    continue;
                } else if let Some(m) = matched {
                    // The source statement maps to two target statements
                    flag(&mut source_ambiguous, source_id);
                    flag(&mut target_ambiguous, m);
                    flag(&mut target_ambiguous, target_id);
                    continue;
                }
                *mapping = Some(source_id);
                matched = Some(target_id);
            }
        }

        for (target_id, (&source_id, &ambiguous)) in target_mapping.iter().zip(&target_ambiguous).enumerate() {
            let Some(source_id) = source_id else { continue };
            if ambiguous || flagged(&source_ambiguous, source_id) {
                continue;
            }
            unique_pairs.push((source_id, target_id));
        }
        unique_pairs.sort_by_key(|p| p.0);
        equal_pairs.sort();
        (unique_pairs, equal_pairs)
    }

    /// The longest common subsequence among the unique pairs (patience sort)
    fn find_lcs(unique_pairs: &[StatementMapping]) -> Vec<StatementMapping> {
        // (source id, target id, size of the previous pile)
        let mut piles: Vec<Vec<(usize, usize, usize)>> = Vec::new();
        for &(source_id, target_id) in unique_pairs {
            match piles.iter().position(|pile| pile.last().is_some_and(|top| top.1 >= target_id)) {
                Some(p) => {
                    let prev_pile_size = piles.get(p.max(1) - 1).map_or(0, Vec::len);
                    if let Some(pile) = piles.get_mut(p) {
                        pile.push((source_id, target_id, prev_pile_size));
                    }
                }
                None => {
                    let prev_pile_size = piles.last().map_or(0, Vec::len);
                    piles.push(vec![(source_id, target_id, prev_pile_size)]);
                }
            }
        }
        // Walk back from the top of the last pile, an entry points to the top of the previous pile when it was pushed
        let mut lcs = Vec::new();
        let mut entry_id = None;
        for pile in piles.iter().rev() {
            let entry = match entry_id {
                None => pile.last(),
                Some(i) => pile.get(i),
            };
            let Some(&(source_id, target_id, prev_pile_size)) = entry else { break };
            lcs.push((source_id, target_id));
            entry_id = Some(prev_pile_size.wrapping_sub(1));
        }
        lcs.reverse();
        lcs
    }

    /// The changed sub-ranges within an UPDATE target statement (target-side highlighting)
    fn collect_target_changes(&self, source: &Statement, target: &Statement) -> Vec<TextSpan> {
        let mut changes = Vec::new();
        if source.root as usize >= self.source.nodes.len() || target.root as usize >= self.target.nodes.len() {
            return changes;
        }
        let record = |changes: &mut Vec<TextSpan>, target_node_id: usize| {
            // A node outside of the AST has no text
            let Some(node) = self.target.nodes.get(target_node_id) else { return };
            let span = resolve(self.target, node);
            if span.length > 0 {
                changes.push(span);
            }
        };
        let mut pending = vec![(source.root as usize, target.root as usize)];
        let mut src_children = Vec::new();
        let mut tgt_children = Vec::new();
        while let Some((source_id, target_id)) = pending.pop() {
            // A pair outside of the AST has no changes to show
            let (Some(&s), Some(&t)) = (self.source.nodes.get(source_id), self.target.nodes.get(target_id)) else {
                continue;
            };
            // Different node type: the entire target subtree changed
            if s.node_type() != t.node_type() {
                record(&mut changes, target_id);
                continue;
            }
            if let Some(m) = self.leaf_match(&s, &t) {
                if !m {
                    record(&mut changes, target_id);
                }
            } else if s.node_type() == NodeType::ARRAY {
                let (sc, tc) = (s.children_count(), t.children_count());
                let (sb, tb) = (s.children_begin_or_value(), t.children_begin_or_value());
                let common = sc.min(tc);
                for i in 0..common {
                    pending.push(((sb + i) as usize, (tb + i) as usize));
                }
                // Extra target children are additions
                for i in common..tc {
                    record(&mut changes, (tb + i) as usize);
                }
            } else if is_object_type(s.node_type()) {
                collect_sorted_children(self.source, &s, &mut src_children);
                collect_sorted_children(self.target, &t, &mut tgt_children);
                let (mut i, mut j) = (0, 0);
                while let (Some(&(sk, si)), Some(&(tk, ti))) = (src_children.get(i), tgt_children.get(j)) {
                    if sk < tk {
                        i += 1;
                    } else if sk > tk {
                        record(&mut changes, ti as usize);
                        j += 1;
                    } else {
                        pending.push((si as usize, ti as usize));
                        i += 1;
                        j += 1;
                    }
                }
                for &(_, child) in tgt_children.iter().skip(j) {
                    record(&mut changes, child as usize);
                }
            } else if is_enum_type(s.node_type()) && s.children_begin_or_value() != t.children_begin_or_value() {
                record(&mut changes, target_id);
            }
        }
        // Sort and coalesce overlapping or adjacent spans
        if changes.len() > 1 {
            changes.sort_by_key(|c| c.offset);
            let mut coalesced: Vec<TextSpan> = Vec::with_capacity(changes.len());
            for change in &changes {
                let Some(last) = coalesced.last_mut() else {
                    coalesced.push(*change);
                    continue;
                };
                let last_end = last.end();
                if change.offset <= last_end {
                    let new_end = last_end.max(change.end());
                    *last = TextSpan::new(last.offset, new_end - last.offset);
                } else {
                    coalesced.push(*change);
                }
            }
            changes = coalesced;
        }
        changes
    }

    /// Emit a diff operation
    fn emit(&self, out: &mut Vec<DiffOp>, code: ScriptDiffOpCode, source_id: Option<usize>, target_id: Option<usize>) {
        let mut op = DiffOp {
            code,
            source_statement: None,
            target_statement: None,
            source_span: TextSpan::default(),
            target_span: TextSpan::default(),
            target_changes: Vec::new(),
        };
        // The ids are statement indices of the scripts, the span of an id outside of them stays empty
        let source_stmt = source_id.and_then(|s| self.source.statements.get(s));
        let target_stmt = target_id.and_then(|t| self.target.statements.get(t));
        if let Some(s) = source_id {
            op.source_statement = Some(s as u32);
            op.source_span = source_stmt.map_or(TextSpan::default(), |stmt| resolve_statement_span(self.source, stmt));
        }
        if let Some(t) = target_id {
            op.target_statement = Some(t as u32);
            op.target_span = target_stmt.map_or(TextSpan::default(), |stmt| resolve_statement_span(self.target, stmt));
        }
        if let (ScriptDiffOpCode::UPDATE, Some(s), Some(t)) = (code, source_stmt, target_stmt) {
            op.target_changes = self.collect_target_changes(s, t);
        }
        out.push(op);
    }

    /// The best unmatched target among `targets` for a source statement: the highest similarity score at or above
    /// the threshold
    fn best_update_target(
        &mut self,
        source_id: usize,
        targets: impl Iterator<Item = usize>,
        target_matched: &[bool],
    ) -> Option<usize> {
        let &source_stmt = self.source.statements.get(source_id)?;
        let mut best_target = None;
        let mut best_score = -1.0;
        for target_id in targets {
            if flagged(target_matched, target_id) {
                continue;
            }
            let Some(&target_stmt) = self.target.statements.get(target_id) else { continue };
            if self.estimate_similarity(&source_stmt, &target_stmt) == SimilarityEstimate::NotEqual {
                continue;
            }
            let score = self.compute_similarity(&source_stmt, &target_stmt).score();
            if score >= UPDATE_SIMILARITY_THRESHOLD && score > best_score {
                best_score = score;
                best_target = Some(target_id);
            }
        }
        best_target
    }

    /// Compute the diff (memoized)
    ///
    /// The statements are matched first and emitted after, so that the direction of a move does not decide between
    /// a MOVE and an INSERT + DELETE. The matching goes in rounds, each over the statements that are still unmatched:
    /// the longest common subsequence of the unique pairs is kept, the other equal statements move, a statement
    /// updates the most similar statement of its section (between the same two kept statements), and then the most
    /// similar statement of another section. The operations are emitted section by section: the operations of the
    /// source statements, the inserted target statements, and the kept statement that ends the section.
    pub fn compute(&mut self) -> &[DiffOp] {
        if self.computed {
            return &self.ops;
        }
        self.computed = true;
        let source_count = self.source.statements.len();
        let target_count = self.target.statements.len();
        let (unique_pairs, equal_pairs) = self.map_statements();
        let lcs = Self::find_lcs(&unique_pairs);

        // The source and target statements of a section, between two LCS entries (exclusive)
        let section = |index: usize| -> (std::ops::Range<usize>, std::ops::Range<usize>) {
            let (source_begin, target_begin) =
                index.checked_sub(1).and_then(|i| lcs.get(i)).map_or((0, 0), |&(s, t)| (s + 1, t + 1));
            let (source_end, target_end) = lcs.get(index).copied().unwrap_or((source_count, target_count));
            (source_begin..source_end, target_begin..target_end)
        };

        // The matched target and operation of every source statement
        let mut source_match: SourceMatches = vec![None; source_count];
        let mut target_matched = vec![false; target_count];
        for &(source_id, target_id) in &lcs {
            claim(&mut source_match, &mut target_matched, ScriptDiffOpCode::KEEP, source_id, target_id);
        }
        // Equal statements outside of the LCS move, a source statement to its first unmatched equal target
        for &(source_id, target_id) in &equal_pairs {
            if unmatched(&source_match, source_id) && !flagged(&target_matched, target_id) {
                claim(&mut source_match, &mut target_matched, ScriptDiffOpCode::MOVE, source_id, target_id);
            }
        }
        // Similar statements in the same section update
        for section_index in 0..=lcs.len() {
            let (sources, targets) = section(section_index);
            for source_id in sources {
                if !unmatched(&source_match, source_id) {
                    continue;
                }
                if let Some(target_id) = self.best_update_target(source_id, targets.clone(), &target_matched) {
                    claim(&mut source_match, &mut target_matched, ScriptDiffOpCode::UPDATE, source_id, target_id);
                }
            }
        }
        // Similar statements in different sections update, the statement moves
        for section_index in 0..=lcs.len() {
            let (sources, targets) = section(section_index);
            for source_id in sources {
                if !unmatched(&source_match, source_id) {
                    continue;
                }
                let others = (0..target_count).filter(|t| !targets.contains(t));
                if let Some(target_id) = self.best_update_target(source_id, others, &target_matched) {
                    claim(&mut source_match, &mut target_matched, ScriptDiffOpCode::UPDATE, source_id, target_id);
                }
            }
        }

        let mut out = Vec::new();
        for section_index in 0..=lcs.len() {
            let (sources, targets) = section(section_index);
            for source_id in sources {
                match source_match.get(source_id).copied().flatten() {
                    Some((code, target_id)) => self.emit(&mut out, code, Some(source_id), Some(target_id)),
                    None => self.emit(&mut out, ScriptDiffOpCode::DELETE, Some(source_id), None),
                }
            }
            for target_id in targets {
                if !flagged(&target_matched, target_id) {
                    self.emit(&mut out, ScriptDiffOpCode::INSERT, None, Some(target_id));
                }
            }
            if let Some(&(source_id, target_id)) = lcs.get(section_index) {
                self.emit(&mut out, ScriptDiffOpCode::KEEP, Some(source_id), Some(target_id));
            }
        }
        self.ops = out;
        &self.ops
    }

    /// Pack the diff into the FlatBuffers object API
    pub fn pack(&mut self) -> ScriptDiffT {
        let span = |s: &TextSpan| TextSpanT { offset: s.offset, length: s.length };
        let ops = self
            .compute()
            .iter()
            .map(|op| {
                let mut out = ScriptDiffOpT::default();
                out.code = op.code;
                out.source_statement = op.source_statement.unwrap_or(u32::MAX);
                out.target_statement = op.target_statement.unwrap_or(u32::MAX);
                out.source_span = op.source_statement.map(|_| span(&op.source_span));
                out.target_span = op.target_statement.map(|_| span(&op.target_span));
                out.target_changes =
                    (!op.target_changes.is_empty()).then(|| op.target_changes.iter().map(span).collect());
                out
            })
            .collect();
        let mut diff = ScriptDiffT::default();
        diff.ops = Some(ops);
        diff
    }
}
