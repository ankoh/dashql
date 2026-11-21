sql_create_function_stmt:
    sql_cmd_create_function_stmt { $1 }
  | CREATE_P sql_opt_temp AGGREGATE sql_func_name sql_aggregate_signature RETURNS sql_function_param_type {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_FUNCTION,
            ctx.concat2(
                $5,
                &[
                    attr(Key::SQL_CREATE_FUNCTION_NAME, ctx.array(@4, $4)),
                    attr(Key::SQL_CREATE_FUNCTION_RETURNS, $7),
                    attr(Key::SQL_CREATE_FUNCTION_TEMP, $2),
                    attr(Key::SQL_CREATE_FUNCTION_IS_AGGREGATE, bool_node(@3, true)),
                ],
            ),
        )
    }
    ;



sql_function_param_type:
    sql_typename    { $1 }
  | ANY {
      ctx.object(
          @$,
          NodeType::OBJECT_SQL_TYPENAME,
          &[
              attr(
                  Key::SQL_TYPENAME_TYPE,
                  ctx.object(
                      @1,
                      NodeType::OBJECT_SQL_GENERIC_TYPE,
                      &[attr(Key::SQL_GENERIC_TYPE_NAME, ctx.name_from_keyword(@1, "any"))],
                  ),
              ),
          ],
      )
  }
    ;

sql_aggregate_signature:
 LRB STAR RRB { ctx.list(&[attr(Key::SQL_CREATE_FUNCTION_STAR,bool_node(@2,true))]) }
 | LRB RRB { ctx.list(&[attr(Key::SQL_CREATE_FUNCTION_PARAMS,ctx.array_ex(@$,NO_NODES,false,false))]) }
 | LRB sql_cmd_aggr_args_list RRB { ctx.list(&[attr(Key::SQL_CREATE_FUNCTION_PARAMS,ctx.array(@$,$2))]) }
 | LRB ORDER BY sql_cmd_aggr_args_list RRB { ctx.list(&[attr(Key::SQL_CREATE_FUNCTION_ORDER_PARAMS,ctx.array(@4,$4))]) }
 | LRB sql_cmd_aggr_args_list ORDER BY sql_cmd_aggr_args_list RRB {
        ctx.list(&[
            attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.array(@2, $2)),
            attr(Key::SQL_CREATE_FUNCTION_ORDER_PARAMS, ctx.array(@5, $5)),
        ])
    }
 ;
