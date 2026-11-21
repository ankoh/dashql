sql_drop_table_stmt:
    DROP TABLE sql_qualified_name sql_drop_more_names sql_alter_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_TABLE,
            &[
                attr(Key::SQL_DROP_NAME, $3),
                attr(Key::SQL_DROP_MORE_NAMES, ctx.array(@4, $4)),
                attr(Key::SQL_DROP_CASCADE, $5),
            ],
        )
    }
  | DROP TABLE IF_P EXISTS sql_qualified_name sql_drop_more_names sql_alter_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_TABLE,
            &[
                attr(Key::SQL_DROP_IF_EXISTS, bool_node(loc(&[@3, @4]), true)),
                attr(Key::SQL_DROP_NAME, $5),
                attr(Key::SQL_DROP_MORE_NAMES, ctx.array(@6, $6)),
                attr(Key::SQL_DROP_CASCADE, $7),
            ],
        )
    }
    ;

sql_drop_view_stmt:
    DROP VIEW sql_qualified_name sql_drop_more_names sql_alter_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_VIEW,
            &[
                attr(Key::SQL_DROP_NAME, $3),
                attr(Key::SQL_DROP_MORE_NAMES, ctx.array(@4, $4)),
                attr(Key::SQL_DROP_CASCADE, $5),
            ],
        )
    }
  | DROP VIEW IF_P EXISTS sql_qualified_name sql_drop_more_names sql_alter_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_VIEW,
            &[
                attr(Key::SQL_DROP_IF_EXISTS, bool_node(loc(&[@3, @4]), true)),
                attr(Key::SQL_DROP_NAME, $5),
                attr(Key::SQL_DROP_MORE_NAMES, ctx.array(@6, $6)),
                attr(Key::SQL_DROP_CASCADE, $7),
            ],
        )
    }
    ;

sql_attach_database_stmt:
    ATTACH sql_attach_database_locality DATABASE sql_attach_database_path AS sql_attach_database_alias sql_attach_database_options {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ATTACH_DATABASE,
            &[
                attr(Key::SQL_ATTACH_DATABASE_LOCAL, $2),
                attr(Key::SQL_ATTACH_DATABASE_PATH, $4),
                attr(Key::SQL_ATTACH_DATABASE_ALIAS, $6),
                attr(Key::SQL_ATTACH_DATABASE_OPTIONS, $7),
            ],
        )
    }
    ;

sql_attach_database_locality:
    LOCAL           { bool_node(@$, true) }
  | %empty          { null() }
    ;

sql_attach_database_path:
    sql_col_id       { $1 }
    ;

sql_attach_database_alias:
    sql_col_id       { $1 }
    ;

sql_attach_database_options:
    WITH LRB sql_attach_database_option_list RRB  { ctx.array(@$, $3) }
  | %empty                                      { null() }
    ;

sql_attach_database_option_list:
    sql_attach_database_option { ctx.list(&[$1]) }
  | sql_attach_database_option_list COMMA sql_attach_database_option {
      ctx.push_back($1, $3);
      $1
  }
    ;

sql_attach_database_option:
    sql_attach_database_value EQUALS sql_attach_database_value {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ATTACH_DATABASE_OPTION,
            &[attr(Key::SQL_GENERIC_OPTION_KEY, $1), attr(Key::SQL_GENERIC_OPTION_VALUE, $3)],
        )
    }
  | sql_attach_database_value EQUALS DEFAULT {
      ctx.object(
          @$,
          NodeType::OBJECT_SQL_ATTACH_DATABASE_OPTION,
          &[
              attr(Key::SQL_GENERIC_OPTION_KEY, $1),
              attr(Key::SQL_GENERIC_OPTION_VALUE, ctx.name_from_keyword(@3, "default")),
          ],
      )
  }
    ;

sql_attach_database_value:
    IDENT                       { name_from_identifier(@1, $1) }
  | sql_unreserved_keywords     { ctx.name_from_keyword(@1, $1) }
  | sql_column_name_keywords    { ctx.name_from_keyword(@1, $1) }
  | sql_type_func_keywords      { ctx.name_from_keyword(@1, $1) }
  | SCONST                      { const_node(@1, AConstType::STRING) }
    ;

sql_drop_more_names: COMMA sql_qualified_name_list { $2 } | %empty { ctx.list(NO_NODES) };
