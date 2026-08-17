sql_drop_table_stmt:
    DROP TABLE sql_opt_if_exists sql_qualified_name {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_DROP_TABLE, {
            Attr(Key::SQL_DROP_IF_EXISTS, $3),
            Attr(Key::SQL_DROP_NAME, std::move($4)),
        });
    }
    ;

sql_drop_view_stmt:
    DROP VIEW sql_opt_if_exists sql_qualified_name {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_DROP_VIEW, {
            Attr(Key::SQL_DROP_IF_EXISTS, $3),
            Attr(Key::SQL_DROP_NAME, std::move($4)),
        });
    }
    ;

sql_opt_if_exists:
    IF_P EXISTS     { $$ = Bool(@$, true); }
  | %empty          { $$ = Null(); }
    ;

sql_attach_database_stmt:
    ATTACH sql_attach_database_locality DATABASE sql_attach_database_path AS sql_attach_database_alias sql_attach_database_options {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_ATTACH_DATABASE, {
            Attr(Key::SQL_ATTACH_DATABASE_LOCAL, $2),
            Attr(Key::SQL_ATTACH_DATABASE_PATH, $4),
            Attr(Key::SQL_ATTACH_DATABASE_ALIAS, $6),
            Attr(Key::SQL_ATTACH_DATABASE_OPTIONS, $7),
        });
    }
    ;

sql_attach_database_locality:
    LOCAL           { $$ = Bool(@$, true); }
  | %empty          { $$ = Null(); }
    ;

sql_attach_database_path:
    sql_col_id       { $$ = $1; }
    ;

sql_attach_database_alias:
    sql_col_id       { $$ = $1; }
    ;

sql_attach_database_options:
    WITH LRB sql_attach_database_option_list RRB  { $$ = ctx.Array(@$, std::move($3)); }
  | %empty                                      { $$ = Null(); }
    ;

sql_attach_database_option_list:
    sql_attach_database_option {
        $$ = ctx.List({ std::move($1) });
    }
  | sql_attach_database_option_list COMMA sql_attach_database_option {
        $1->push_back(std::move($3));
        $$ = std::move($1);
    }
    ;

sql_attach_database_option:
    sql_attach_database_value EQUALS sql_attach_database_value {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_ATTACH_DATABASE_OPTION, {
            Attr(Key::SQL_GENERIC_OPTION_KEY, $1),
            Attr(Key::SQL_GENERIC_OPTION_VALUE, $3),
        });
    }
  | sql_attach_database_value EQUALS DEFAULT {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_ATTACH_DATABASE_OPTION, {
            Attr(Key::SQL_GENERIC_OPTION_KEY, $1),
            Attr(Key::SQL_GENERIC_OPTION_VALUE, ctx.NameFromKeyword(@3, "default")),
        });
    }
    ;

sql_attach_database_value:
    IDENT                       { $$ = NameFromIdentifier(@1, $1); }
  | sql_unreserved_keywords     { $$ = ctx.NameFromKeyword(@1, $1); }
  | sql_column_name_keywords    { $$ = ctx.NameFromKeyword(@1, $1); }
  | sql_type_func_keywords      { $$ = ctx.NameFromKeyword(@1, $1); }
  | SCONST                      { $$ = Const(@1, buffers::parser::AConstType::STRING); }
    ;
