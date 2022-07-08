use super::program_instance::*;
use crate::grammar::{ASTCell, ASTNode, Indirection, Statement, TableRef};
use dashql_proto as proto;

fn normalize_name_with<'a, F, R>(inst: &mut ProgramInstance<'a>, name: &'a [ASTCell<Indirection<'a>>], f: F) -> R
where
    F: Fn(&mut ProgramInstance<'a>, &[ASTCell<Indirection<'a>>], bool) -> R,
{
    let mut path: [&'a str; 3] = [""; 3];
    let mut path_length = 0;
    for (i, elem) in name.iter().enumerate().take(3) {
        match elem.get() {
            Indirection::Name(s) => {
                path[i] = s.clone();
                path_length += 1;
            }
            _ => break,
        }
    }
    let path = &path[0..path_length];
    if path.len() > 1 {
        return f(inst, name, false);
    }
    let node: Indirection<'a> = if let Some(schema) = inst.cached_default_schema.borrow().clone() {
        Indirection::Name(schema)
    } else {
        let s = inst.context.arena.alloc_str(&inst.context.settings.default_schema);
        Indirection::Name(s)
    };
    f(inst, &[ASTCell::with_value(node), name[0].clone()], true)
}

fn normalize_name_clone<'a>(
    ctx: &mut ProgramInstance<'a>,
    name: &'a [ASTCell<Indirection<'a>>],
) -> &'a [ASTCell<Indirection<'a>>] {
    normalize_name_with(ctx, name, |inst, normalized, tmp| -> &'a [ASTCell<Indirection<'a>>] {
        if tmp {
            inst.context.arena.alloc_slice_clone(normalized)
        } else {
            name
        }
    })
}

fn resolve_statement_id<'a>(ctx: &mut ProgramInstance<'a>, node_id: usize) -> usize {
    let nodes = ctx.program_proto.nodes().unwrap_or_default();
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

pub fn normalize_statement_names<'a>(ctx: &mut ProgramInstance<'a>) {
    let prog = ctx.program.clone();
    let stmts = &prog.statements;
    for (stmt_id, stmt) in stmts.iter().enumerate() {
        let name = match stmt {
            Statement::CreateAs(create) => Some(normalize_name_clone(ctx, create.name.get())),
            Statement::Create(create) => Some(normalize_name_clone(ctx, create.name.get())),
            Statement::CreateView(view) => Some(normalize_name_clone(ctx, view.name.get())),
            Statement::Import(import) => Some(normalize_name_clone(ctx, import.name.get())),
            Statement::Load(load) => Some(normalize_name_clone(ctx, load.name.get())),
            Statement::Declare(input) => Some(normalize_name_clone(ctx, input.name.get())),
            _ => None,
        };
        if let Some(name) = name {
            ctx.statement_names[stmt_id] = Some(name);
            ctx.statement_by_name.insert(name, stmt_id);
        }
    }
}

pub fn discover_statement_dependencies<'a>(ctx: &mut ProgramInstance<'a>) {
    for stmt_id in 0..ctx.program.statements.len() {
        let target = match ctx.program.statements[stmt_id] {
            Statement::Load(l) => normalize_name_with(ctx, l.source.get(), |_, normalized, _| normalized.to_vec()),
            _ => continue,
        };
        if let Some(target_stmt_id) = ctx.statement_by_name.get(target.as_slice()).cloned() {
            ctx.statement_required_for.insert(
                (target_stmt_id, stmt_id as usize),
                (proto::DependencyType::TABLE_REF, usize::MAX),
            );
            ctx.statement_depends_on.insert(
                (stmt_id as usize, target_stmt_id),
                (proto::DependencyType::TABLE_REF, usize::MAX),
            );
        }
    }
    for (node_id, node_proto) in ctx.program_proto.nodes().unwrap_or_default().iter().enumerate() {
        let node_translated = ctx.program.ast_translated[node_id];
        match node_proto.node_type() {
            proto::NodeType::OBJECT_SQL_COLUMN_REF => {
                if let ASTNode::ColumnRef(name) = &node_translated {
                    let target = normalize_name_clone(ctx, name);
                    if let Some(stmt) = ctx.statement_by_name.get(target).cloned() {
                        let target_stmt_id = resolve_statement_id(ctx, node_id as usize) as u32;
                        ctx.statement_required_for.insert(
                            (stmt, target_stmt_id as usize),
                            (proto::DependencyType::COLUMN_REF, node_id),
                        );
                        ctx.statement_depends_on.insert(
                            (target_stmt_id as usize, stmt),
                            (proto::DependencyType::COLUMN_REF, node_id),
                        );
                    }
                }
            }
            proto::NodeType::OBJECT_SQL_TABLEREF => {
                if let ASTNode::TableRef(TableRef::Relation(rel)) = &node_translated {
                    let target = normalize_name_clone(ctx, rel.name.get());
                    if let Some(stmt) = ctx.statement_by_name.get(target).cloned() {
                        let target_stmt_id = resolve_statement_id(ctx, node_id as usize) as u32;
                        ctx.statement_required_for.insert(
                            (stmt, target_stmt_id as usize),
                            (proto::DependencyType::TABLE_REF, node_id),
                        );
                        ctx.statement_depends_on.insert(
                            (target_stmt_id as usize, stmt),
                            (proto::DependencyType::TABLE_REF, node_id),
                        );
                    }
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod test {
    use dashql_proto::DependencyType;

    use super::*;
    use crate::execution::execution_context::ExecutionContext;
    use crate::external::parser::parse_into;
    use crate::grammar;
    use std::collections::HashMap;
    use std::error::Error;
    use std::rc::Rc;

    #[derive(Debug, PartialEq, Eq)]
    struct DependencyTest {
        dep_type: DependencyType,
        source_statement: usize,
        target_statement: usize,
    }

    // Test a difference
    async fn test_name_resolution(
        script: &'static str,
        expected: &[DependencyTest],
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let context = ExecutionContext::create_simple(&arena).await?;
        let (ast, ast_data) = parse_into(&arena, script)?;
        let prog = Rc::new(grammar::deserialize_ast(&arena, script, ast, ast_data).unwrap());
        let mut ctx = ProgramInstance::new(context, script, ast, prog, HashMap::new());
        normalize_statement_names(&mut ctx);
        discover_statement_dependencies(&mut ctx);
        let have: Vec<_> = ctx
            .statement_required_for
            .iter()
            .map(|((source, target), (dep_type, _))| DependencyTest {
                dep_type: *dep_type,
                source_statement: *source as usize,
                target_statement: *target as usize,
            })
            .collect();
        assert_eq!(&have, expected);
        Ok(())
    }

    #[tokio::test]
    async fn test_simple_0() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_name_resolution(
            r#"
CREATE TABLE foo AS SELECT 1;
        "#,
            &[],
        )
        .await
    }

    #[tokio::test]
    async fn test_simple_1() -> Result<(), Box<dyn Error + Send + Sync>> {
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
        .await
    }

    #[tokio::test]
    async fn test_simple_2() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_name_resolution(
            r#"
CREATE TABLE foo AS SELECT 1;
VISUALIZE foo USING TABLE;
VISUALIZE foo USING BAR CHART;
        "#,
            &[
                DependencyTest {
                    dep_type: DependencyType::TABLE_REF,
                    source_statement: 0,
                    target_statement: 1,
                },
                DependencyTest {
                    dep_type: DependencyType::TABLE_REF,
                    source_statement: 0,
                    target_statement: 2,
                },
            ],
        )
        .await
    }

    #[tokio::test]
    async fn test_simple_3() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_name_resolution(
            r#"
CREATE TABLE foo AS SELECT 1;
CREATE TABLE foo2 AS SELECT 2;
VISUALIZE foo USING TABLE;
VISUALIZE foo2 USING BAR CHART;
        "#,
            &[
                DependencyTest {
                    dep_type: DependencyType::TABLE_REF,
                    source_statement: 0,
                    target_statement: 2,
                },
                DependencyTest {
                    dep_type: DependencyType::TABLE_REF,
                    source_statement: 1,
                    target_statement: 3,
                },
            ],
        )
        .await
    }
}
