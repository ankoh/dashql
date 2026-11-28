// ---------------------------------------------------------------------------
// CALL <name>(<arguments>), a statement of the backend. The arguments are those of a function call in a query.

sql_call_stmt:
    CALL_P sql_qualified_name LRB RRB {
        ctx.object(@$, NodeType::OBJECT_SQL_CALL, &[attr(Key::SQL_CALL_NAME, $2)])
    }
  | CALL_P sql_qualified_name LRB sql_func_arg_list RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CALL,
            &[attr(Key::SQL_CALL_NAME, $2), attr(Key::SQL_CALL_ARGS, ctx.array(loc(&[@3, @4, @5]), $4))],
        )
    }
    ;
