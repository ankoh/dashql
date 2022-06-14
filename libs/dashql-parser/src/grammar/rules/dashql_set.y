dashql_set_statement:
    SET dson_key_path '=' dson_value {
        auto val = ctx.AddDSONField(Loc({@2, @3, @4}), move($2), $4);
        auto obj = ctx.Add(Loc({@2, @3, @4}), proto::NodeType::OBJECT_DSON, { val });
        $$ = ctx.Add(@$, proto::NodeType::OBJECT_DASHQL_SET, {
            Attr(Key::DASHQL_SET_FIELDS, obj)
        });
    }
