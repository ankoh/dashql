sql_insert_stmt:
    INSERT INTO sql_qualified_name sql_insert_rest sql_insert_returning_clause {
        auto target = ctx.Object(@3, buffers::parser::NodeType::OBJECT_SQL_TABLEREF, {
            Attr(Key::SQL_TABLEREF_NAME, std::move($3)),
        });
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_INSERT,
                        Concat(std::move($4), {
                            Attr(Key::SQL_INSERT_TARGET, target),
                            Attr(Key::SQL_INSERT_RETURNING, std::move($5)),
                        }));
    }
  | sql_with_clause INSERT INTO sql_qualified_name sql_insert_rest sql_insert_returning_clause {
        auto target = ctx.Object(@4, buffers::parser::NodeType::OBJECT_SQL_TABLEREF, {
            Attr(Key::SQL_TABLEREF_NAME, std::move($4)),
        });
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_INSERT,
                        Concat(std::move($1), std::move($5), {
                            Attr(Key::SQL_INSERT_TARGET, target),
                            Attr(Key::SQL_INSERT_RETURNING, std::move($6)),
                        }));
    }
    ;

sql_insert_rest:
    sql_select_stmt {
        $$ = ctx.List({
            Attr(Key::SQL_INSERT_SOURCE,
                 ctx.Object(@1, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($1))),
        });
    }
  | LRB sql_name_list RRB sql_select_stmt {
        $$ = ctx.List({
            Attr(Key::SQL_INSERT_COLUMNS, ctx.Array(Loc({@1, @2, @3}), std::move($2))),
            Attr(Key::SQL_INSERT_SOURCE,
                 ctx.Object(@4, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($4))),
        });
    }
  | DEFAULT VALUES {
        $$ = ctx.List({ Attr(Key::SQL_INSERT_DEFAULT_VALUES, Bool(@$, true)) });
    }
    ;

sql_insert_returning_clause:
    RETURNING sql_target_list { $$ = ctx.Array(@2, std::move($2)); }
  | %empty                    { $$ = Null(); }
    ;
