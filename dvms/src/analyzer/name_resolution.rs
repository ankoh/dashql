use super::analysis_context::*;
use crate::grammar::{ASTNode, Indirection, Statement, TableRef};
use dashql_proto::syntax as sx;

fn normalize_name<'a>(ctx: &mut ProgramAnalysisContext<'a>, name: &'a [Indirection<'a>]) -> &'a [Indirection<'a>] {
    let mut path: [&'a str; 3] = [""; 3];
    let mut path_length = 0;
    for (i, elem) in name.iter().enumerate().take(3) {
        match elem {
            Indirection::Name(s) => {
                path[i] = s.clone();
                path_length += 1;
            }
            _ => break,
        }
    }
    let path = &path[0..path_length];
    if path.len() == 1 {
        let node: Indirection<'a> = if let Some(schema) = ctx.cached_default_schema {
            Indirection::Name(schema)
        } else {
            let s = ctx.arena.alloc_str(&ctx.settings.default_schema);
            Indirection::Name(s)
        };
        ctx.arena.alloc_slice_clone(&[node, name[0].clone()])
    } else {
        name
    }
}

fn resolve_statement_id<'a>(ctx: &mut ProgramAnalysisContext<'a>, node_id: usize) -> usize {
    let nodes = ctx.program_flat.nodes().unwrap_or_default();
    let mut cursor = node_id;
    while (nodes[cursor].parent() as usize) != cursor {
        cursor = nodes[cursor].parent() as usize;
    }
    match ctx.statement_by_root.get(&cursor) {
        Some(stmt_id) => stmt_id.clone(),
        None => {
            debug_assert!(false, "failed to resolve statement id from node: {}", node_id);
            0_usize
        }
    }
}

pub fn normalize_statement_names<'a>(ctx: &mut ProgramAnalysisContext<'a>) {
    let prog = ctx.program_translated.clone();
    let stmts = &prog.statements;
    for (stmt_id, stmt) in stmts.iter().enumerate() {
        let name = match stmt {
            Statement::CreateAs(create) => Some(normalize_name(ctx, create.name)),
            Statement::Create(create) => Some(normalize_name(ctx, create.name)),
            Statement::CreateView(view) => Some(normalize_name(ctx, view.name)),
            Statement::Fetch(fetch) => Some(normalize_name(ctx, fetch.name)),
            Statement::Load(load) => Some(normalize_name(ctx, load.name)),
            Statement::Input(input) => Some(normalize_name(ctx, input.name)),
            _ => None,
        };
        if let Some(name) = name {
            ctx.statement_names[stmt_id] = Some(name);
            ctx.statement_by_name.insert(name, stmt_id);
        }
    }
}

pub fn discover_statement_dependencies<'a>(ctx: &mut ProgramAnalysisContext<'a>) {
    for (node_id, node_flat) in ctx.program_flat.nodes().unwrap_or_default().iter().enumerate() {
        let node_translated = &ctx.program_translated.nodes[node_id];
        match node_flat.node_type() {
            sx::NodeType::OBJECT_SQL_COLUMN_REF => {
                if let ASTNode::ColumnRef(name) = &node_translated {
                    let target = normalize_name(ctx, name);
                    if let Some(stmt) = ctx.statement_by_name.get(target).cloned() {
                        let target_stmt_id = resolve_statement_id(ctx, node_id as usize) as u32;
                        ctx.statement_deps.push(sx::DependencyT {
                            type_: sx::DependencyType::COLUMN_REF,
                            source_statement: stmt as u32,
                            target_statement: target_stmt_id,
                            target_node: node_id as u32,
                        });
                    }
                }
            }
            sx::NodeType::OBJECT_SQL_TABLEREF => {
                if let ASTNode::TableRef(TableRef::Relation(rel)) = &node_translated {
                    let target = normalize_name(ctx, rel.name);
                    if let Some(stmt) = ctx.statement_by_name.get(target).cloned() {
                        let target_stmt_id = resolve_statement_id(ctx, node_id as usize) as u32;
                        ctx.statement_deps.push(sx::DependencyT {
                            type_: sx::DependencyType::TABLE_REF,
                            source_statement: stmt as u32,
                            target_statement: target_stmt_id,
                            target_node: node_id as u32,
                        });
                    }
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod test {
    use dashql_proto::syntax::DependencyType;

    use super::*;
    use crate::analyzer::analysis_context::ProgramAnalysisSettings;
    use crate::grammar;
    use std::error::Error;
    use std::rc::Rc;

    #[derive(Debug, PartialEq, Eq)]
    struct DependencyTest {
        dep_type: DependencyType,
        source_statement: usize,
        target_statement: usize,
    }

    // Test a difference
    fn test_name_resolution(script: &str, expected: &[DependencyTest]) -> Result<(), Box<dyn Error + Send + Sync>> {
        let settings = Rc::new(ProgramAnalysisSettings::default());
        let arena = bumpalo::Bump::new();
        let ast = grammar::parse(&arena, script)?;
        let prog = Rc::new(grammar::deserialize_ast(&arena, script, ast)?);
        let mut ctx = ProgramAnalysisContext::new(settings.clone(), &arena, script, ast, prog);
        normalize_statement_names(&mut ctx);
        discover_statement_dependencies(&mut ctx);
        let have: Vec<_> = ctx
            .statement_deps
            .iter()
            .map(|dep| DependencyTest {
                dep_type: dep.type_,
                source_statement: dep.source_statement as usize,
                target_statement: dep.target_statement as usize,
            })
            .collect();
        assert_eq!(&have, expected);
        Ok(())
    }

    #[test]
    fn test_simple_0() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_name_resolution(
            r#"
CREATE TABLE foo AS SELECT 1;
VISUALIZE foo USING TABLE;
        "#,
            &[DependencyTest {
                dep_type: DependencyType::TABLE_REF,
                source_statement: 0,
                target_statement: 1,
            }],
        )
    }
}
