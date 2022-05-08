use super::ast::*;
use super::ast_nodes_sql::*;
use super::script_writer::*;

impl<'a> AsScript for RelationRef<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 3);
        if !self.inherit {
            a.push(w.keyword("only"));
            a.push(w.space());
        }
        a.push(name_as_script(w, self.name));
        w.float(a.finish())
    }
}

impl<'a> AsScript for TableRef<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match self {
            TableRef::Relation(rel) => rel.as_script(w),
            _ => todo!(),
        }
    }
}

impl<'a> AsScript for ResultTarget<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match self {
            ResultTarget::Star => w.str_const("*"),
            ResultTarget::Value { value, alias } => {
                let mut a = ScriptTextArray::with_capacity(w, 3);
                a.push(value.as_script(w));
                if let Some(alias) = alias {
                    a.push(w.space());
                    a.push(w.str(alias));
                }
                w.float(a.finish())
            }
        }
    }
}

impl<'a> AsScript for SelectFromStatement<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 3 + self.targets.len() * 3 + self.from.len() * 3);
        a.push(w.keyword("select"));
        for (i, target) in self.targets.iter().enumerate() {
            if i > 0 {
                a.push(w.str_const(","));
            }
            a.push(w.space());
            a.push(target.as_script(w));
        }
        if !self.from.is_empty() {
            a.push(w.space());
            a.push(w.keyword("from"));
            for (i, table) in self.from.iter().enumerate() {
                if i > 0 {
                    a.push(w.str_const(","));
                }
                a.push(w.space());
                a.push(table.as_script(w));
            }
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for SelectStatement<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 1);
        match &self.data {
            SelectData::From(from) => a.push(from.as_script(w)),
            SelectData::Combine(c) => todo!(),
            SelectData::Table(t) => todo!(),
            SelectData::Values(to) => todo!(),
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for Statement<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match &self {
            Statement::Select(s) => s.as_script(w),
            _ => todo!(),
        }
    }
}

impl<'a> AsScript for Expression<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match self {
            Expression::Null => w.str_const("null"),
            Expression::Boolean(b) => {
                if *b {
                    w.str_const("true")
                } else {
                    w.str_const("false")
                }
            }
            Expression::Array(elems) => {
                let mut a = ScriptTextArray::with_capacity(w, 3 * elems.len());
                for (i, e) in elems.iter().enumerate() {
                    if i > 0 {
                        a.push(w.str_const(","));
                        a.push(w.space());
                    }
                    a.push(e.as_script(w));
                }
                w.round_brackets(a.finish())
            }
            Expression::Case(c) => {
                let mut f = ScriptTextArray::with_capacity(w, 8 + 8 * c.cases.len());
                f.push(w.keyword("case"));
                if let Some(arg) = &c.argument {
                    f.push(w.space());
                    f.push(arg.as_script(w));
                }
                f.push(w.space());
                for case in c.cases.iter() {
                    f.push(w.keyword("when"));
                    f.push(w.space());
                    f.push(case.when.as_script(w));
                    f.push(w.space());
                    f.push(w.keyword("then"));
                    f.push(w.space());
                    f.push(case.then.as_script(w));
                    f.push(w.space());
                }
                if let Some(default) = &c.default {
                    f.push(w.keyword("else"));
                    f.push(default.as_script(w));
                    f.push(w.space());
                }
                f.push(w.keyword("end"));
                w.float(f.finish())
            }
            Expression::ColumnRef(name) => name_as_script(w, name),
            Expression::ConstCast(_) => todo!(),
            Expression::Exists(e) => {
                let mut t = ScriptTextArray::with_capacity(w, 3);
                t.push(w.keyword("EXISTS"));
                t.push(w.space());
                t.push(e.statement.as_script(w));
                w.float(t.finish())
            }
            Expression::FunctionCall(_) => todo!(),
            Expression::Indirection(_) => todo!(),
            Expression::Nary(_) => todo!(),
            Expression::ParameterRef(_) => todo!(),
            Expression::SelectStatement(_) => todo!(),
            Expression::StringRef(s) => w.str(s.clone()),
            Expression::Subquery(_) => todo!(),
            Expression::TypeCast(_) => todo!(),
            Expression::TypeTest(_) => todo!(),
        }
    }
}

pub fn name_as_script<'writer, 'ast: 'writer>(
    w: &ScriptWriter<'writer>,
    name: &'ast [Indirection<'ast>],
) -> ScriptText<'writer> {
    let mut t = ScriptTextArray::with_capacity(w, 5 * name.len());
    for (i, e) in name.iter().enumerate() {
        match e {
            Indirection::Name(n) => {
                if i > 0 {
                    t.push(w.str_const("."));
                }
                t.push(w.str(n));
            }
            Indirection::Index(idx) => {
                t.push(w.str_const("["));
                t.push(idx.value.as_script(w));
                t.push(w.str_const("]"));
            }
            Indirection::Bounds(bounds) => {
                t.push(w.str_const("["));
                t.push(bounds.lower_bound.as_script(w));
                t.push(w.str_const(", "));
                t.push(bounds.upper_bound.as_script(w));
                t.push(w.str_const("]"));
            }
        }
    }
    w.float(t.finish())
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::grammar;
    use std::error::Error;

    fn test_statement_writing(text: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let ast = grammar::parse(&arena, text)?;
        let prog = grammar::deserialize_ast(&arena, text, ast)?;
        assert_eq!(prog.statements.len(), 1);

        let writer_arena = bumpalo::Bump::new();
        let writer = ScriptWriter::with_arena(&writer_arena);
        let script_text = prog.statements[0].as_script(&writer);
        let script_string = write_script_string(&script_text, &ScriptTextConfig::default());

        assert_eq!(text, &script_string);
        Ok(())
    }

    #[test]
    fn test_select_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_statement_writing("select 1")
    }
    #[test]
    fn test_select_null() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_statement_writing("select null")
    }
    #[test]
    fn test_select_from_foo() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_statement_writing("select * from foo")
    }
    #[test]
    fn test_select_from_foo_qual() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_statement_writing("select * from main.foo")
    }
}
