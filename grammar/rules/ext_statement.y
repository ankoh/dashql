%start opt_statement_list;

opt_statement_list:
    statement_list
  | %empty

statement_list:
    statement_list SEMICOLON opt_statement  { ctx.add_statement($3); }
  | error                             {
      ctx.reset_statement();
  }
  | statement                         { ctx.add_statement($1); }
  | SEMICOLON opt_statement { ctx.add_statement($2); }
    ;
opt_statement:
    statement   { $1 }
  | error       {
      ctx.clear_lookahead();
      null()
  }
  | %empty      { null() }

statement:
    sql_query_statement          { $1 }
    ;

sql_query_statement:
    sql_select_stmt       { ctx.object(@$, NodeType::OBJECT_SQL_SELECT, $1) }
  | sql_create_stmt       { $1 }
  | sql_create_as_stmt    { $1 }
  | sql_view_stmt         { $1 }
  | set_statement         { $1 }
  | sql_create_function_stmt  { $1 }
  | explain_stmt              { $1 }
  | sql_drop_table_stmt       { $1 }
  | sql_drop_view_stmt        { $1 }
  | sql_alter_table_stmt      { $1 }
  | sql_alter_view_stmt       { $1 }
  | sql_create_schema_stmt    { $1 }
  | sql_drop_schema_stmt      { $1 }
  | sql_alter_schema_stmt     { $1 }
  | sql_attach_database_stmt  { $1 }
  | sql_insert_stmt           { $1 }
  | sql_delete_stmt           { $1 }
  | sql_transaction_stmt      { $1 }
  | call_stmt                 { $1 }
  | sql_cmd_update_stmt { $1 }
  | sql_cmd_merge_stmt { $1 }
  | sql_cmd_copy_stmt { $1 }
  | sql_cmd_truncate_stmt { $1 }
  | sql_cmd_prepare_stmt { $1 }
  | sql_cmd_execute_stmt { $1 }
  | sql_cmd_deallocate_stmt { $1 }
  | sql_cmd_alter_db_stmt { $1 }
  | sql_cmd_alter_group_stmt { $1 }
  | sql_cmd_alter_role_set_stmt { $1 }
  | sql_cmd_alter_role_stmt { $1 }
  | sql_cmd_alter_seq_stmt { $1 }
  | sql_cmd_alter_user_set_stmt { $1 }
  | sql_cmd_alter_user_stmt { $1 }
  | sql_cmd_analyze_stmt { $1 }
  | sql_cmd_close_portal_stmt { $1 }
  | sql_cmd_close_external_stream_stmt { $1 }
  | sql_cmd_comment_stmt { $1 }
  | sql_cmd_create_db_stmt { $1 }
  | sql_cmd_create_db_from_stmt { $1 }
  | sql_cmd_create_external_stream_stmt { $1 }
  | sql_cmd_create_external_table_stmt { $1 }
  | sql_cmd_create_group_stmt { $1 }
  | sql_cmd_create_index_stmt { $1 }
  | sql_cmd_create_role_stmt { $1 }
  | sql_cmd_create_seq_stmt { $1 }
  | sql_cmd_create_user_stmt { $1 }
  | sql_cmd_declare_cursor_stmt { $1 }
  | sql_cmd_define_stmt { $1 }
  | sql_cmd_detach_db_stmt { $1 }
  | sql_cmd_drop_db_stmt { $1 }
  | sql_cmd_drop_func_stmt { $1 }
  | sql_cmd_drop_group_stmt { $1 }
  | sql_cmd_drop_role_stmt { $1 }
  | sql_cmd_drop_stmt { $1 }
  | sql_cmd_drop_user_stmt { $1 }
  | sql_cmd_export_db_stmt { $1 }
  | sql_cmd_fetch_stmt { $1 }
  | sql_cmd_grant_role_stmt { $1 }
  | sql_cmd_grant_stmt { $1 }
  | sql_cmd_import_db_stmt { $1 }
  | sql_cmd_rename_stmt { $1 }
  | sql_cmd_revoke_role_stmt { $1 }
  | sql_cmd_revoke_stmt { $1 }
  | sql_cmd_unload_db_stmt { $1 }
  | sql_cmd_unload_release_stmt { $1 }
  | sql_cmd_validate_stmt { $1 }
  | sql_cmd_variable_show_stmt { $1 }
  | sql_cmd_variable_reset_stmt { $1 }
    ;
