dashql_set_statement:
    SET dson_key_path '=' dson_value {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_SET, {
            ctx.AddDSONField(Loc({@2, @3, @4}), move($2), $4)
        });
    }
