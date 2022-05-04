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

pub struct ProgramAnalysisContext<'text, 'ast> {
    pub text: &'text str,
    pub ast: sx::Program<'ast>,
    pub subtree_sizes: Vec<usize>,
}

pub fn compute_tree_size<'text, 'ast>(ctx: &mut ProgramAnalysisContext<'text, 'ast>, node_id: usize) -> usize {
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

pub fn estimate_similarity<'source_txt, 'source_ast, 'target_txt, 'target_ast>(
    source: (&'source_txt str, sx::Program<'source_ast>, usize),
    target: (&'source_txt str, sx::Program<'source_ast>, usize),
) -> SimilarityEstimate {
    let (source_txt, source_prog, source_stmt_id) = source;
    let (target_txt, target_prog, target_stmt_id) = target;
    let source_nodes = source_prog.nodes().unwrap_or_default();
    let target_nodes = target_prog.nodes().unwrap_or_default();
    let source_stmt = source_prog.statements().unwrap_or_default().get(source_stmt_id);
    let target_stmt = target_prog.statements().unwrap_or_default().get(target_stmt_id);

    // Different root node types?
    let s = source_nodes[source_stmt.root_node() as usize];
    let t = target_nodes[target_stmt.root_node() as usize];
    if s.node_type() != t.node_type() {
        return SimilarityEstimate::NotEqual;
    }

    // Do a string comparison if the strings are equal in size and number of root attributes.
    // This will bypass us the tree diffing for all unchanged statements.
    if (s.children_count() == t.children_count()) && (s.location().length() == t.location().length()) {
        let st = text_at(source_txt, *s.location());
        let tt = text_at(target_txt, *t.location());
        if st == tt {
            return SimilarityEstimate::Equal;
        }
    }
    SimilarityEstimate::Similar
}

pub fn compute_similarity(
    source: (&mut ProgramAnalysisContext<'_, '_>, usize),
    target: (&mut ProgramAnalysisContext<'_, '_>, usize),
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

pub fn check_deep_equality(
    source: (&mut ProgramAnalysisContext<'_, '_>, usize),
    target: (&mut ProgramAnalysisContext<'_, '_>, usize),
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

// // Find unique statement pair in two lists of statement ids
// pub fn map_statements(
//     source: (&'source_txt str, sx::Program<'source_ast>),
//     target: (&'target_txt str, sx::Program<'target_ast>),
// )
