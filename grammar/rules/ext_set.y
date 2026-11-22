set_statement:
    SET sql_cmd_set_rest { ctx.set(@$, $2) }
  | SET LOCAL sql_cmd_set_rest { ctx.set(@$, ctx.concat2($3, &[attr(Key::SQL_SET_LOCAL, bool_node(@2, true))])) }
  | SET SESSION sql_cmd_set_rest { ctx.set(@$, $3) }
    ;
sql_set_more_values: COMMA sql_cmd_var_list { $2 } | %empty { ctx.list(NO_NODES) };
