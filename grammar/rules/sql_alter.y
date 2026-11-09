sql_alter_table_stmt:
    ALTER TABLE sql_qualified_name sql_alter_table_action_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_TABLE,
            &[attr(Key::SQL_ALTER_TABLE_NAME, $3), attr(Key::SQL_ALTER_TABLE_ACTIONS, ctx.array(@4, $4))],
        )
    }
  | ALTER TABLE IF_P EXISTS sql_qualified_name sql_alter_table_action_list {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_TABLE,
            &[
                attr(Key::SQL_ALTER_TABLE_IF_EXISTS, bool_node(loc(&[@3, @4]), true)),
                attr(Key::SQL_ALTER_TABLE_NAME, $5),
                attr(Key::SQL_ALTER_TABLE_ACTIONS, ctx.array(@6, $6)),
            ],
        )
    }
    ;

sql_alter_table_action_list:
    sql_alter_table_action { ctx.list(&[$1]) }
  | sql_alter_table_action_list COMMA sql_alter_table_action {
        ctx.push_back($1, $3);
        $1
    }
    ;

// The actions that change what a catalog holds about a table
sql_alter_table_action:
    ADD_P sql_alter_opt_column sql_column_def { ctx.object(@$, NodeType::OBJECT_SQL_ALTER_ADD_COLUMN, &[attr(Key::SQL_ALTER_ACTION_COLUMN, $3)]) }
  | ADD_P sql_alter_opt_column IF_P NOT EXISTS sql_column_def {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_ADD_COLUMN,
            &[attr(Key::SQL_ALTER_ACTION_IF, bool_node(loc(&[@3, @4, @5]), true)), attr(Key::SQL_ALTER_ACTION_COLUMN, $6)],
        )
    }
  | DROP sql_alter_opt_column sql_col_id sql_alter_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_DROP_COLUMN,
            &[attr(Key::SQL_ALTER_ACTION_COLUMN, $3), attr(Key::SQL_ALTER_ACTION_CASCADE, $4)],
        )
    }
  | DROP sql_alter_opt_column IF_P EXISTS sql_col_id sql_alter_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_DROP_COLUMN,
            &[
                attr(Key::SQL_ALTER_ACTION_IF, bool_node(loc(&[@3, @4]), true)),
                attr(Key::SQL_ALTER_ACTION_COLUMN, $5),
                attr(Key::SQL_ALTER_ACTION_CASCADE, $6),
            ],
        )
    }
  | DROP sql_alter_opt_column sql_col_id IF_P EXISTS sql_alter_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_DROP_COLUMN,
            &[
                attr(Key::SQL_ALTER_ACTION_COLUMN, $3),
                attr(Key::SQL_ALTER_ACTION_IF_AFTER, bool_node(loc(&[@4, @5]), true)),
                attr(Key::SQL_ALTER_ACTION_CASCADE, $6),
            ],
        )
    }
  | RENAME sql_alter_opt_column sql_col_id TO sql_col_id {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_RENAME_COLUMN,
            &[attr(Key::SQL_ALTER_ACTION_COLUMN, $3), attr(Key::SQL_ALTER_ACTION_NEW_NAME, $5)],
        )
    }
  | sql_alter_relation_move { $1 }
  | ALTER sql_alter_opt_column sql_col_id TYPE_P sql_typename sql_alter_opt_using {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_COLUMN_TYPE,
            &[attr(Key::SQL_ALTER_ACTION_COLUMN, $3), attr(Key::SQL_ALTER_ACTION_TYPE, $5), attr(Key::SQL_ALTER_ACTION_USING, $6)],
        )
    }
  | ALTER sql_alter_opt_column sql_col_id SET DATA_P TYPE_P sql_typename sql_alter_opt_using {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_COLUMN_TYPE,
            &[attr(Key::SQL_ALTER_ACTION_COLUMN, $3), attr(Key::SQL_ALTER_ACTION_TYPE, $7), attr(Key::SQL_ALTER_ACTION_USING, $8)],
        )
    }
    ;

sql_alter_opt_column:
    COLUMN { null() }
  | %empty { null() }
    ;

sql_alter_opt_using:
    USING sql_a_expr { ctx.expression($2) }
  | %empty { null() }
    ;

sql_alter_view_stmt:
    ALTER VIEW sql_qualified_name sql_alter_relation_move {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_VIEW,
            &[attr(Key::SQL_ALTER_TABLE_NAME, $3), attr(Key::SQL_ALTER_TABLE_ACTIONS, ctx.array(@4, ctx.list(&[$4])))],
        )
    }
  | ALTER VIEW IF_P EXISTS sql_qualified_name sql_alter_relation_move {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ALTER_VIEW,
            &[
                attr(Key::SQL_ALTER_TABLE_IF_EXISTS, bool_node(loc(&[@3, @4]), true)),
                attr(Key::SQL_ALTER_TABLE_NAME, $5),
                attr(Key::SQL_ALTER_TABLE_ACTIONS, ctx.array(@6, ctx.list(&[$6]))),
            ],
        )
    }
    ;

sql_alter_relation_move:
    RENAME TO sql_qualified_name { ctx.object(@$, NodeType::OBJECT_SQL_ALTER_RENAME_TABLE, &[attr(Key::SQL_ALTER_ACTION_NEW_TABLE, $3)]) }
  | SET SCHEMA sql_col_id { ctx.object(@$, NodeType::OBJECT_SQL_ALTER_SET_SCHEMA, &[attr(Key::SQL_ALTER_ACTION_NEW_NAME, $3)]) }
    ;

sql_create_schema_stmt:
    CREATE_P SCHEMA sql_qualified_name { ctx.object(@$, NodeType::OBJECT_SQL_CREATE_SCHEMA, &[attr(Key::SQL_SCHEMA_NAME, $3)]) }
  | CREATE_P SCHEMA IF_P NOT EXISTS sql_qualified_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_CREATE_SCHEMA,
            &[attr(Key::SQL_SCHEMA_IF, bool_node(loc(&[@3, @4, @5]), true)), attr(Key::SQL_SCHEMA_NAME, $6)],
        )
    }
    ;

sql_drop_schema_stmt:
    DROP SCHEMA sql_qualified_name sql_alter_drop_behavior {
        ctx.object(@$, NodeType::OBJECT_SQL_DROP_SCHEMA, &[attr(Key::SQL_SCHEMA_NAME, $3), attr(Key::SQL_SCHEMA_CASCADE, $4)])
    }
  | DROP SCHEMA IF_P EXISTS sql_qualified_name sql_alter_drop_behavior {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_DROP_SCHEMA,
            &[
                attr(Key::SQL_SCHEMA_IF, bool_node(loc(&[@3, @4]), true)),
                attr(Key::SQL_SCHEMA_NAME, $5),
                attr(Key::SQL_SCHEMA_CASCADE, $6),
            ],
        )
    }
    ;

// True for CASCADE and false for RESTRICT, which is what a statement without either means as well
sql_alter_drop_behavior:
    CASCADE { bool_node(@$, true) }
  | RESTRICT { bool_node(@$, false) }
  | %empty { null() }
    ;

sql_alter_schema_stmt:
    ALTER SCHEMA sql_qualified_name RENAME TO sql_col_id {
        ctx.object(@$, NodeType::OBJECT_SQL_ALTER_SCHEMA, &[attr(Key::SQL_SCHEMA_NAME, $3), attr(Key::SQL_SCHEMA_NEW_NAME, $6)])
    }
    ;
