use crate::grammar::SetStatement;

use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use super::dson::*;
use super::program::*;
use super::script_writer::*;
use dashql_proto::syntax as sx;
use dashql_proto::syntax::ExpressionOperator;
use dashql_proto::syntax::VizComponentTypeModifier;

impl<'a> AsScript for CommonTableExpression<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 4);
        a.push(w.str(self.name));
        if self.columns.len() > 0 {
            let mut cols = ScriptTextArray::with_capacity(w, 2 * self.columns.len());
            for (i, col) in self.columns.iter().enumerate() {
                if i > 0 {
                    cols.push(w.str(",").pad_right());
                }
                cols.push(w.str(col));
            }
            a.push(w.round_brackets(cols.finish()).pad_left());
        }
        a.push(w.keyword("as").pad_left().pad_right());
        a.push(
            w.round_brackets(
                ScriptTextArray::with_capacity(w, 1)
                    .with_pushed(self.statement.as_script(w))
                    .finish(),
            ),
        );
        w.float(a.finish())
    }
}

impl<'a> AsScript for OrderSpecification<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 3);
        a.push(self.value.as_script(w));
        if let Some(dir) = self.direction {
            a.push(
                match dir.clone() {
                    sx::OrderDirection::ASCENDING => w.keyword("asc"),
                    _ => w.keyword("desc"),
                }
                .pad_left(),
            );
        }
        if let Some(nulls) = self.null_rule {
            a.push(
                match nulls.clone() {
                    sx::OrderNullRule::NULLS_FIRST => w.keyword("nulls first"),
                    _ => w.keyword("nulls last"),
                }
                .pad_left(),
            );
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for Limit<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        w.float(w.alloc_slice(&[
            w.keyword("limit").pad_right(),
            match self {
                Limit::ALL => w.keyword("all"),
                Limit::Expression(e) => e.as_script(w),
            },
        ]))
    }
}

impl<'a> AsScript for DsonKey<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match self {
            DsonKey::Known(_k) => w.str(self.as_str()),
            DsonKey::Unknown(k) => w.single_quotes(w.str(k)),
        }
    }
}

impl<'a> AsScript for DsonValue<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match self {
            DsonValue::Object(fields) => {
                let mut entries = ScriptTextArray::with_capacity(w, fields.len());
                for (i, field) in fields.iter().enumerate() {
                    let mut kv = ScriptTextArray::with_capacity(w, 4);
                    if i > 0 {
                        kv.push(w.str_const(",").pad_right());
                    }
                    kv.push(field.key.as_script(w).breakpoint_before());
                    kv.push(w.str_const("=").pad_left());
                    kv.push(field.value.as_script(w).pad_left());
                    entries.push(w.float(kv.finish()))
                }
                w.round_brackets(entries.finish())
            }
            DsonValue::Array(vs) => {
                let mut a = ScriptTextArray::with_capacity(w, vs.len());
                for (i, v) in vs.iter().enumerate() {
                    let mut elem = ScriptTextArray::with_capacity(w, 4);
                    if i > 0 {
                        elem.push(w.str_const(",").pad_right());
                    }
                    elem.push(v.as_script(w).breakpoint_before());
                    a.push(w.float(elem.finish()))
                }
                w.square_brackets(a.finish())
            }
            DsonValue::Expression(e) => e.as_script(w),
        }
    }
}

impl<'a> AsScript for Alias<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 1);
        a.push(w.str(self.name));
        // todo: column defs
        w.float(a.finish())
    }
}

impl<'a> AsScript for RelationRef<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 3);
        if !self.inherit {
            a.push(w.keyword("only").pad_right());
        }
        a.push(name_as_script(w, self.name));
        if let Some(alias) = self.alias {
            a.push(alias.as_script(w).pad_left())
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for JoinedTable<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 8);
        a.push(self.input[0].as_script(w));
        if (self.join.0 & sx::JoinType::NATURAL_.0) != 0_u8 {
            a.push(w.keyword("natural").pad_left());
        }
        match sx::JoinType(self.join.0 & (sx::JoinType::OUTER_.0 - 1)) {
            sx::JoinType::NONE => a.push(w.keyword("cross").pad_left()),
            sx::JoinType::INNER => {}
            sx::JoinType::FULL => a.push(w.keyword("full").pad_left()),
            sx::JoinType::LEFT => a.push(w.keyword("left").pad_left()),
            sx::JoinType::RIGHT => a.push(w.keyword("right").pad_left()),
            _ => {}
        }
        if (self.join.0 & sx::JoinType::OUTER_.0) != 0_u8 {
            a.push(w.keyword("outer").pad_left());
        }
        a.push(w.keyword("join").pad_left());
        a.push(self.input[1].as_script(w).pad_left());
        match &self.qualifier {
            Some(JoinQualifier::On(expr)) => {
                a.push(w.keyword("on").pad_left());
                a.push(expr.as_script(w).pad_left());
            }
            Some(JoinQualifier::Using(cols)) => {
                a.push(w.keyword("using").pad_left());
                let mut using = ScriptTextArray::with_capacity(w, cols.len() * 3);
                for (i, col) in cols.iter().enumerate() {
                    if i > 0 {
                        using.push(w.str_const(",").pad_right());
                    }
                    using.push(w.str(col));
                }
                a.push(w.round_brackets(using.finish()).pad_left());
            }
            _ => {}
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for JoinedTableRef<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 2);
        a.push(self.table.as_script(w));
        if let Some(alias) = self.alias {
            a.push(alias.as_script(w).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for TableRef<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match self {
            TableRef::Relation(rel) => rel.as_script(w),
            TableRef::Join(joined) => joined.as_script(w),
            _ => todo!(),
        }
    }
}

impl<'a> AsScript for ResultTarget<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match self {
            ResultTarget::Star => w.str_const("*"),
            ResultTarget::Value { value, alias } => {
                let mut a = ScriptTextArray::with_capacity(w, 2);
                a.push(value.as_script(w));
                if let Some(alias) = alias {
                    a.push(w.str(alias).pad_left());
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
            a.push(target.as_script(w).pad_left());
        }
        if !self.from.is_empty() {
            a.push(w.keyword("from").pad_left());
            for (i, table) in self.from.iter().enumerate() {
                if i > 0 {
                    a.push(w.str_const(","));
                }
                a.push(table.as_script(w).pad_left());
            }
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for SelectStatement<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 6 + 2 * self.order_by.len());
        match &self.data {
            SelectData::From(from) => a.push(from.as_script(w)),
            SelectData::Combine(c) => todo!(),
            SelectData::Table(t) => todo!(),
            SelectData::Values(to) => todo!(),
        }
        if !self.order_by.is_empty() {
            a.push(w.keyword("order").pad_left());
            a.push(w.keyword("by").pad_left());
            for (i, constraint) in self.order_by.iter().enumerate() {
                if i > 0 {
                    a.push(w.str_const(","));
                }
                a.push(constraint.as_script(w).pad_left());
            }
        }
        if let Some(limit) = &self.limit {
            a.push(limit.as_script(w).pad_left());
        }
        if let Some(offset) = &self.offset {
            a.push(w.keyword("offset").pad_left());
            a.push(offset.as_script(w).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for Statement<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match &self {
            Statement::Select(s) => s.as_script(w),
            Statement::Set(s) => s.as_script(w),
            Statement::Fetch(s) => s.as_script(w),
            Statement::Load(s) => s.as_script(w),
            Statement::Viz(s) => s.as_script(w),
            _ => todo!(),
        }
    }
}

impl<'a> AsScript for FetchStatement<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 5);
        a.push(w.keyword("fetch"));
        a.push(name_as_script(w, self.name).pad_left());
        a.push(w.keyword("from").pad_left());
        if let Some(uri) = &self.from_uri {
            a.push(uri.as_script(w).pad_left());
        } else {
            a.push(
                w.keyword(match self.method {
                    sx::FetchMethodType::FILE => "file",
                    sx::FetchMethodType::HTTP => "http",
                    _ => "none",
                })
                .pad_left(),
            );
        }
        if let Some(extra) = &self.extra {
            a.push(extra.as_script(w).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for LoadStatement<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 7);
        a.push(w.keyword("load"));
        a.push(name_as_script(w, self.name).pad_left());
        a.push(w.keyword("from").pad_left());
        a.push(name_as_script(w, self.source).pad_left());
        a.push(w.keyword("using").pad_left());
        a.push(
            w.keyword(match self.method {
                sx::LoadMethodType::CSV => "csv",
                sx::LoadMethodType::JSON => "json",
                sx::LoadMethodType::PARQUET => "parquet",
                _ => "none",
            })
            .pad_left(),
        );
        if let Some(extra) = &self.extra {
            a.push(extra.as_script(w).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for VizComponent<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 3 + 2 * self.type_modifiers.count_ones() as usize);
        if let Some(ct) = &self.component_type {
            if *ct != sx::VizComponentType::SPEC {
                let mut mods = self.type_modifiers;
                let mut ti = 0;
                while mods != 0 && ti <= sx::VizComponentTypeModifier::ENUM_MAX {
                    if (mods & 0b1) != 0 {
                        a.push(
                            w.keyword(match VizComponentTypeModifier(ti) {
                                VizComponentTypeModifier::STACKED => "stacked",
                                VizComponentTypeModifier::CLUSTERED => "clustered",
                                VizComponentTypeModifier::MULTI => "multi",
                                VizComponentTypeModifier::DEPENDENT => "dependent",
                                VizComponentTypeModifier::INDEPENDENT => "independent",
                                VizComponentTypeModifier::POLAR => "polar",
                                VizComponentTypeModifier::X => "x",
                                VizComponentTypeModifier::Y => "y",
                                _ => "none",
                            })
                            .pad_left(),
                        );
                    }
                    mods >>= 1;
                    ti += 1;
                }
                a.push(
                    w.keyword(match ct.clone() {
                        sx::VizComponentType::AREA => "area chart",
                        sx::VizComponentType::AXIS => "axis",
                        sx::VizComponentType::BAR => "bar chart",
                        sx::VizComponentType::BOX => "box",
                        sx::VizComponentType::CANDLESTICK => "candlestick chart",
                        sx::VizComponentType::ERROR_BAR => "errorbar chart",
                        sx::VizComponentType::HEX => "hex",
                        sx::VizComponentType::JSON => "json",
                        sx::VizComponentType::LINE => "line chart",
                        sx::VizComponentType::PIE => "pie chart",
                        sx::VizComponentType::SCATTER => "scatter plot",
                        sx::VizComponentType::TABLE => "table",
                        _ => "none",
                    })
                    .pad_left(),
                );
            }
        }
        if let Some(extra) = &self.extra {
            a.push(extra.as_script(w).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for VizStatement<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let mut a = ScriptTextArray::with_capacity(w, 3 + 2 * self.components.len());
        a.push(w.keyword("viz"));
        a.push(self.target.as_script(w).pad_left());
        a.push(w.keyword("using").pad_left());
        for (i, component) in self.components.iter().enumerate() {
            if i > 0 {
                a.push(w.str_const(","));
            }
            a.push(component.as_script(w));
        }
        w.float(a.finish())
    }
}

impl<'a> AsScript for SetStatement<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        let fields = self.fields.as_object();
        assert!(!fields.is_empty(), "unexpected set statement value type");
        assert!(fields.len() == 1, "expected exactly one field: {:?}", fields);
        let mut a = ScriptTextArray::with_capacity(w, 4);
        a.push(w.keyword("set"));
        a.push(fields[0].key.as_script(w).pad_left());
        a.push(w.str_const("=").pad_left());
        a.push(fields[0].value.as_script(w).pad_left());
        w.float(a.finish())
    }
}

impl<'a> AsScript for Expression<'a> {
    fn as_script<'writer, 'ast: 'writer>(&'ast self, w: &ScriptWriter<'writer>) -> ScriptText<'writer> {
        match self {
            Expression::Null => w.str_const("null"),
            Expression::Uint32(v) => w.str(w.arena.alloc_str(&v.to_string())),
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
                        a.push(w.str_const(",").pad_right());
                    }
                    a.push(e.as_script(w));
                }
                w.round_brackets(a.finish())
            }
            Expression::Case(c) => {
                let mut f = ScriptTextArray::with_capacity(w, 5 + 8 * c.cases.len());
                f.push(w.keyword("case"));
                if let Some(arg) = &c.argument {
                    f.push(arg.as_script(w).pad_left());
                }
                for case in c.cases.iter() {
                    f.push(w.keyword("when").pad_left());
                    f.push(case.when.as_script(w).pad_left());
                    f.push(w.keyword("then").pad_left());
                    f.push(case.then.as_script(w).pad_left());
                }
                if let Some(default) = &c.default {
                    f.push(w.keyword("else").pad_left());
                    f.push(default.as_script(w).pad_left());
                }
                f.push(w.keyword("end").pad_left());
                w.float(f.finish())
            }
            Expression::ColumnRef(name) => name_as_script(w, name),
            Expression::ConstCast(_) => todo!(),
            Expression::Exists(e) => {
                let mut t = ScriptTextArray::with_capacity(w, 3);
                t.push(w.keyword("EXISTS"));
                t.push(e.statement.as_script(w).pad_left());
                w.float(t.finish())
            }
            Expression::FunctionCall(_) => todo!(),
            Expression::Indirection(_) => todo!(),
            Expression::Nary(nary) => match nary.operator {
                ExpressionOperatorName::Known(op) => match op {
                    ExpressionOperator::EQUAL => {
                        let mut a = ScriptTextArray::with_capacity(w, 3);
                        a.push(nary.args[0].as_script(w));
                        a.push(w.keyword("=").pad_left());
                        a.push(nary.args[1].as_script(w).pad_left());
                        w.float(a.finish())
                    }
                    _ => todo!(),
                },
                ExpressionOperatorName::Qualified(name) => todo!(),
            },
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

    fn test_pipe(text: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let ast = grammar::parse(&arena, text)?;
        let prog = grammar::deserialize_ast(&arena, text, ast)?;
        assert_eq!(prog.statements.len(), 1);

        let writer_arena = bumpalo::Bump::new();
        let writer = ScriptWriter::with_arena(&writer_arena);
        let script_text = prog.statements[0].as_script(&writer);
        let script_string = write_script_string(&script_text, &ScriptTextConfig::default());

        assert_eq!(text, &script_string, "{:?}", prog);
        Ok(())
    }

    #[test]
    fn test_set() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("set 'foo' = 42")?;
        Ok(())
    }

    #[test]
    fn test_from() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("fetch foo from 'http://someremote'")?;
        test_pipe("fetch foo from http (url = 'http://someremote')")?;
        Ok(())
    }

    #[test]
    fn test_load() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("load a from b using json")?;
        test_pipe("load a from b using csv")?;
        test_pipe("load a from b using parquet")?;
        test_pipe("load a from b using parquet ('someextra' = 'foo')")?;
        Ok(())
    }

    #[test]
    fn test_viz() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("viz a using table")?;
        test_pipe("viz a using stacked bar chart")?;
        test_pipe("viz a using stacked bar chart, x axis ('some' = 'config')")?;
        test_pipe("viz a using clustered bar chart")?;
        test_pipe("viz a using (mark = 'bar')")?;
        test_pipe("viz a using (encoding = ('x' = ('some' = 'thing')), mark = 'bar')")?;
        Ok(())
    }

    #[test]
    fn test_select() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("select 1")?;
        test_pipe("select null")?;
        test_pipe("select * from foo")?;
        test_pipe("select * from only foo f")?;
        test_pipe("select * from main.foo")?;
        test_pipe("select f.g from main.foo f")?;
        test_pipe("select * from A cross join B")?;
        test_pipe("select * from A join B using (a, b)")?;
        test_pipe("select * from A join B on a = b")?;
        test_pipe("select * from A left join B on a = b")?;
        test_pipe("select * from A left outer join B on a = b")?;
        test_pipe("select * from A right join B on a = b")?;
        test_pipe("select * from A right outer join B on a = b")?;
        test_pipe("select * from A order by a")?;
        test_pipe("select * from A order by a, b")?;
        test_pipe("select * from A order by a asc")?;
        test_pipe("select * from A order by a asc nulls first")?;
        test_pipe("select * from A order by a desc")?;
        test_pipe("select * from A order by a nulls first")?;
        test_pipe("select * from A order by a asc nulls first, b desc")?;
        test_pipe("select * from A order by a limit 10")?;
        test_pipe("select * from A order by a limit 10 offset 10")?;
        test_pipe("select * from A order by a limit all")?;
        Ok(())
    }

    #[test]
    fn test_linebreaks() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe(
            &r#"viz a using table (
    position = (row = 0, column = 1, width = 10, height = 4),
    encoding = (x = ('foo' = 'bar'), y = ('foo' = 'bar2'))
)"#,
        )?;
        Ok(())
    }
}
