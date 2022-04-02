use super::node::Node;
use crate::proto::syntax as sx;

pub fn translate_ast<'text, 'ast>(text: &'text str, ast: sx::Program<'ast>) {
    let statements = ast.statements().unwrap_or_default();
    let nodes = ast.nodes().unwrap_or_default();

    // Collect children
    let mut children: Vec<Vec<Node<'text>>> = Vec::new();
    children.resize(nodes.len(), Vec::new());

    // Do a postorder dfs traversal
    let mut out: Vec<Node<'text>> = Vec::new();
    let mut pending: Vec<(usize, bool)> = Vec::new();
    for statement in statements.iter() {
        pending.push((statement.root_node() as usize, false));

        while !pending.is_empty() {
            let (ti, visited) = pending.last().copied().unwrap();
            let t = nodes[ti as usize];

            // Not visited yet?
            // Mark as visited and push all children to the stack.
            if !visited {
                pending.last_mut().unwrap().1 = true;
                if t.node_type() == sx::NodeType::ARRAY
                    || t.node_type() > sx::NodeType::OBJECT_KEYS_
                {
                    for i in 0..t.children_count() {
                        pending.push(((t.children_begin_or_value() + i) as usize, false));
                    }
                }
                continue;
            }

            // Translate the node
            let translated = match t.node_type() {
                sx::NodeType::NONE => Node::Null,
                sx::NodeType::BOOL => Node::Boolean(ti, t.children_begin_or_value() != 0),
                sx::NodeType::UI32 => Node::UInt32(ti, t.children_begin_or_value()),
                sx::NodeType::UI32_BITMAP => Node::UInt32Bitmap(ti, t.children_begin_or_value()),
                sx::NodeType::STRING_REF => Node::StringRef(
                    ti,
                    &text[(t.location().offset() as usize)
                        ..((t.location().offset() + t.location().length()) as usize)],
                ),
                sx::NodeType::ARRAY => {
                    let mut c = Vec::new();
                    std::mem::swap(&mut c, &mut children[ti as usize]);
                    Node::Array(ti, c)
                }
                _ => panic!("node translation not implemented"),
            };

            // Stack empty?
            // Returned to statement root then, otherwise push as child
            pending.pop();
            if pending.is_empty() {
                out.push(translated);
            } else {
                debug_assert!(t.parent() != u32::MAX);
                debug_assert!((t.parent() as usize) < nodes.len());
                children[t.parent() as usize].push(translated);
            }
        }
    }
}
