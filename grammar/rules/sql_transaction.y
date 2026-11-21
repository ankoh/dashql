// TransactionStmt in Hyper's hyper/parser/sql/sql.ypp.
sql_transaction_stmt:
    BEGIN_P sql_opt_transaction sql_transaction_modes {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, ctx.name_from_keyword(@1, "begin")),
            attr(Key::SQL_TRANSACTION_MODES, $3),
        ])
    }
  | START TRANSACTION sql_transaction_modes {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, ctx.name_from_keyword(@1, "start")),
            attr(Key::SQL_TRANSACTION_MODES, $3),
        ])
    }
  | sql_transaction_end sql_opt_transaction {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[attr(Key::SQL_TRANSACTION_COMMAND, $1)])
    }
  | ROLLBACK sql_opt_transaction sql_transaction_rollback_target {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, ctx.name_from_keyword(@1, "rollback")),
            attr(Key::SQL_TRANSACTION_TARGET, $3),
        ])
    }
  | SAVEPOINT sql_col_id {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, ctx.name_from_keyword(@1, "savepoint")),
            attr(Key::SQL_TRANSACTION_TARGET, $2),
        ])
    }
  | RELEASE sql_transaction_savepoint {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, ctx.name_from_keyword(@1, "release")),
            attr(Key::SQL_TRANSACTION_TARGET, $2),
        ])
    }
  | PREPARE TRANSACTION SCONST {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, ctx.name_from_keyword(@1, "prepare")),
            attr(Key::SQL_TRANSACTION_TARGET, const_node(@3, AConstType::STRING)),
            attr(Key::SQL_TRANSACTION_PREPARED, bool_node(@2, true)),
        ])
    }
  | COMMIT PREPARED SCONST {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, ctx.name_from_keyword(@1, "commit")),
            attr(Key::SQL_TRANSACTION_TARGET, const_node(@3, AConstType::STRING)),
            attr(Key::SQL_TRANSACTION_PREPARED, bool_node(@2, true)),
        ])
    }
  | ROLLBACK PREPARED SCONST {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, ctx.name_from_keyword(@1, "rollback")),
            attr(Key::SQL_TRANSACTION_TARGET, const_node(@3, AConstType::STRING)),
            attr(Key::SQL_TRANSACTION_PREPARED, bool_node(@2, true)),
        ])
    }
    ;

sql_transaction_end:
    COMMIT   { ctx.name_from_keyword(@1, "commit") }
  | END_P    { ctx.name_from_keyword(@1, "end") }
  | ABORT_P  { ctx.name_from_keyword(@1, "abort") }
    ;

sql_opt_transaction:
    WORK
  | TRANSACTION
  | %empty
    ;

sql_transaction_savepoint:
    sql_col_id           { $1 }
  | SAVEPOINT sql_col_id { $2 }
    ;

sql_transaction_rollback_target:
    TO sql_transaction_savepoint { $2 }
  | %empty                       { null() }
    ;

sql_transaction_modes:
    sql_transaction_mode_list { ctx.array(@$, $1) }
  | %empty                    { null() }
    ;

sql_transaction_mode_list:
    sql_transaction_mode { ctx.list(&[$1]) }
  | sql_transaction_mode_list COMMA sql_transaction_mode {
        ctx.push_back($1, $3);
        $1
    }
  | sql_transaction_mode_list sql_transaction_mode {
        ctx.push_back($1, $2);
        $1
    }
    ;

sql_transaction_mode:
    ISOLATION LEVEL sql_transaction_isolation_level {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION_MODE, &[attr(Key::SQL_TRANSACTION_ISOLATION_LEVEL, $3)])
    }
  | READ_P ONLY {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION_MODE, &[attr(Key::SQL_TRANSACTION_READ_ONLY, bool_node(@$, true))])
    }
  | READ_P WRITE_P {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION_MODE, &[attr(Key::SQL_TRANSACTION_READ_ONLY, bool_node(@$, false))])
    }
  | DEFERRABLE {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION_MODE, &[attr(Key::SQL_TRANSACTION_DEFERRABLE, bool_node(@$, true))])
    }
  | NOT DEFERRABLE {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION_MODE, &[attr(Key::SQL_TRANSACTION_DEFERRABLE, bool_node(@$, false))])
    }
    ;

sql_transaction_isolation_level:
    READ_P UNCOMMITTED { ctx.name_from_keyword(@$, "read uncommitted") }
  | READ_P COMMITTED   { ctx.name_from_keyword(@$, "read committed") }
  | REPEATABLE READ_P  { ctx.name_from_keyword(@$, "repeatable read") }
  | SERIALIZABLE       { ctx.name_from_keyword(@$, "serializable") }
    ;
