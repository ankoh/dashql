
sql_json_expr:
    JSON LRB sql_json_value sql_json_unique RRB { ctx.object(@$,NodeType::OBJECT_SQL_JSON_PARSE,&[attr(Key::SQL_JSON_VALUE,$3),attr(Key::SQL_JSON_UNIQUE_KEYS,$4)]) }
  | JSON_SCALAR LRB sql_a_expr RRB { ctx.object(@$,NodeType::OBJECT_SQL_JSON_SCALAR,&[attr(Key::SQL_JSON_VALUE,ctx.expression($3))]) }
  | JSON_OBJECT LRB sql_json_member_list sql_json_nulls sql_json_unique RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_OBJECT,
            &[
                attr(Key::SQL_JSON_MEMBERS, ctx.array(@3, $3)),
                attr(Key::SQL_JSON_ABSENT_ON_NULL, $4),
                attr(Key::SQL_JSON_UNIQUE_KEYS, $5),
            ],
        )
    }
  | JSON_OBJECT LRB RRB { ctx.object(@$,NodeType::OBJECT_SQL_JSON_OBJECT,&[attr(Key::SQL_JSON_MEMBERS,ctx.array_ex(@$,NO_NODES,false,false))]) }
  | JSON_ARRAY LRB sql_json_value_list sql_json_nulls RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_ARRAY,
            &[
                attr(Key::SQL_JSON_VALUES, ctx.array(@3, $3)),
                attr(Key::SQL_JSON_ABSENT_ON_NULL, $4),
            ],
        )
    }
  | JSON_ARRAY LRB RRB { ctx.object(@$,NodeType::OBJECT_SQL_JSON_ARRAY,&[attr(Key::SQL_JSON_VALUES,ctx.array_ex(@$,NO_NODES,false,false))]) }
  | JSON_QUERY LRB sql_json_value COMMA sql_a_expr sql_json_passing sql_json_returning sql_json_wrapper sql_json_quotes sql_json_behaviors RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_QUERY,
            &[
                attr(Key::SQL_JSON_VALUE, $3),
                attr(Key::SQL_JSON_PATH, ctx.expression($5)),
                attr(Key::SQL_JSON_PASSING, $6),
                attr(Key::SQL_JSON_RETURNING, $7),
                attr(Key::SQL_JSON_WRAPPER, $8),
                attr(Key::SQL_JSON_QUOTES, $9),
                attr(Key::SQL_JSON_BEHAVIORS, $10),
            ],
        )
    }
  | JSON_VALUE LRB sql_json_value COMMA sql_a_expr sql_json_passing sql_json_returning sql_json_behaviors RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_VALUE,
            &[
                attr(Key::SQL_JSON_VALUE, $3),
                attr(Key::SQL_JSON_PATH, ctx.expression($5)),
                attr(Key::SQL_JSON_PASSING, $6),
                attr(Key::SQL_JSON_RETURNING, $7),
                attr(Key::SQL_JSON_BEHAVIORS, $8),
            ],
        )
    }
  | JSON_EXISTS LRB sql_json_value COMMA sql_a_expr sql_json_passing sql_json_on_error RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_EXISTS,
            &[
                attr(Key::SQL_JSON_VALUE, $3),
                attr(Key::SQL_JSON_PATH, ctx.expression($5)),
                attr(Key::SQL_JSON_PASSING, $6),
                attr(Key::SQL_JSON_ON_ERROR, $7),
            ],
        )
    }
    ;
sql_json_value:
    sql_a_expr sql_json_format {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_INPUT,
            &[attr(Key::SQL_JSON_VALUE, ctx.expression($1)), attr(Key::SQL_JSON_FORMAT, $2)],
        )
    }
    ;
sql_json_format:
    FORMAT JSON { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_json_unique:
    WITH UNIQUE KEYS { bool_node(@$,true) }
  | WITH UNIQUE %prec UNBOUNDED { bool_node(@$,true) }
  | WITHOUT UNIQUE KEYS { bool_node(@$,false) }
  | WITHOUT UNIQUE %prec UNBOUNDED { bool_node(@$,false) }
  | %empty %prec UNBOUNDED { null() }
    ;
sql_json_member_list:
    sql_json_member { ctx.list(&[$1]) }
  | sql_json_member_list COMMA sql_json_member { ctx.push_back($1,$3);$1 }
    ;
sql_json_member:
    sql_a_expr COLON sql_json_value {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_MEMBER,
            &[
                attr(Key::SQL_JSON_MEMBER_KEY, ctx.expression($1)),
                attr(Key::SQL_JSON_MEMBER_VALUE, $3),
            ],
        )
    }
    ;
sql_json_value_list:
    sql_json_value { ctx.list(&[$1]) }
  | sql_json_value_list COMMA sql_json_value { ctx.push_back($1,$3);$1 }
    ;
sql_json_nulls:
    NULL_P ON NULL_P { bool_node(@$,false) }
  | ABSENT ON NULL_P { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_json_passing:
    PASSING sql_json_arguments { ctx.array(@$,$2) }
  | %empty { null() }
    ;
sql_json_arguments:
    sql_json_argument { ctx.list(&[$1]) }
  | sql_json_arguments COMMA sql_json_argument { ctx.push_back($1,$3);$1 }
    ;
sql_json_argument:
    sql_a_expr AS sql_col_id {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_ARGUMENT,
            &[
                attr(Key::SQL_JSON_ARGUMENT_NAME, $3),
                attr(Key::SQL_JSON_ARGUMENT_VALUE, ctx.expression($1)),
            ],
        )
    }
    ;
sql_json_returning:
    RETURNING sql_typename { $2 }
  | %empty { null() }
    ;
sql_json_wrapper:
    WITHOUT WRAPPER { ctx.name_from_keyword(@$,"without") }
  | WITHOUT ARRAY_LA WRAPPER { ctx.name_from_keyword(@$,"without") }
  | WITH WRAPPER { ctx.name_from_keyword(@$,"with") }
  | WITH ARRAY_LA WRAPPER { ctx.name_from_keyword(@$,"with") }
  | WITH CONDITIONAL ARRAY_LA WRAPPER { ctx.name_from_keyword(@$,"conditional") }
  | WITH UNCONDITIONAL ARRAY_LA WRAPPER { ctx.name_from_keyword(@$,"unconditional") }
  | WITH CONDITIONAL WRAPPER { ctx.name_from_keyword(@$,"conditional") }
  | WITH UNCONDITIONAL WRAPPER { ctx.name_from_keyword(@$,"unconditional") }
  | %empty { null() }
    ;
sql_json_quotes:
    QUOTE { bool_node(@$,true) }
  | KEEP QUOTES { bool_node(@$,true) }
  | OMIT QUOTES { bool_node(@$,false) }
  | %empty { null() }
    ;
sql_json_behavior:
    NULL_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_BEHAVIOR,
            &[attr(Key::SQL_JSON_BEHAVIOR_KIND, ctx.name_from_keyword(@$, "null"))],
        )
    }
  | ERROR_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_BEHAVIOR,
            &[attr(Key::SQL_JSON_BEHAVIOR_KIND, ctx.name_from_keyword(@$, "error"))],
        )
    }
  | TRUE_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_BEHAVIOR,
            &[attr(Key::SQL_JSON_BEHAVIOR_KIND, ctx.name_from_keyword(@$, "true"))],
        )
    }
  | FALSE_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_BEHAVIOR,
            &[attr(Key::SQL_JSON_BEHAVIOR_KIND, ctx.name_from_keyword(@$, "false"))],
        )
    }
  | UNKNOWN {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_BEHAVIOR,
            &[attr(Key::SQL_JSON_BEHAVIOR_KIND, ctx.name_from_keyword(@$, "unknown"))],
        )
    }
  | EMPTY ARRAY {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_BEHAVIOR,
            &[attr(Key::SQL_JSON_BEHAVIOR_KIND, ctx.name_from_keyword(@$, "empty array"))],
        )
    }
  | EMPTY OBJECT_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_BEHAVIOR,
            &[attr(Key::SQL_JSON_BEHAVIOR_KIND, ctx.name_from_keyword(@$, "empty object"))],
        )
    }
  | DEFAULT sql_a_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_BEHAVIOR,
            &[
                attr(Key::SQL_JSON_BEHAVIOR_KIND, ctx.name_from_keyword(@1, "default")),
                attr(Key::SQL_JSON_BEHAVIOR_DEFAULT, ctx.expression($2)),
            ],
        )
    }
    ;
sql_json_behaviors:
    sql_json_behavior ON EMPTY { ctx.object(@$,NodeType::OBJECT_SQL_JSON_BEHAVIORS,&[attr(Key::SQL_JSON_ON_EMPTY,$1)]) }
  | sql_json_behavior ON ERROR_P { ctx.object(@$,NodeType::OBJECT_SQL_JSON_BEHAVIORS,&[attr(Key::SQL_JSON_ON_ERROR,$1)]) }
  | sql_json_behavior ON EMPTY sql_json_behavior ON ERROR_P {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_JSON_BEHAVIORS,
            &[attr(Key::SQL_JSON_ON_EMPTY, $1), attr(Key::SQL_JSON_ON_ERROR, $4)],
        )
    }
  | %empty { null() }
    ;
sql_json_on_error:
    sql_json_behavior ON ERROR_P { $1 }
  | %empty { null() }
    ;
