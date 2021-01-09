sql_view_stmt:
    CREATE_P sql_opt_temp VIEW sql_qualified_name sql_opt_column_list AS sql_select_stmt {
        $$ = concat(std::move($4), {
                Key::SQL_VIEW_TEMP << Enum(@2, $2),
                Key::SQL_VIEW_NAME << ctx.Add(@4, move($4)),
                Key::SQL_VIEW_COLUMNS << ctx.Add(@5, move($5)),
                Key::SQL_VIEW_STATEMENT << ctx.Add(@7, sx::NodeType::OBJECT_SQL_VIEW, move($7)),
        });
    }
    ;
