set_statement:
SET sql_cmd_set_rest { with_span($2,@$) }
 | SET LOCAL sql_cmd_set_rest {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SET_STATEMENT,
            &[
                attr(Key::SQL_SET_STATEMENT_LOCAL, bool_node(@2, true)),
                attr(Key::SQL_SET_STATEMENT_ARG, $3),
            ],
        )
    }
 | SET SESSION sql_cmd_set_rest { ctx.object(@$,NodeType::OBJECT_SQL_SET_STATEMENT,&[attr(Key::SQL_SET_STATEMENT_ARG,$3)]) }
    ;
sql_set_more_values: COMMA sql_cmd_var_list { $2 } | %empty { ctx.list(NO_NODES) };
