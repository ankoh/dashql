// TransactionStmt in Hyper's hyper/parser/sql/sql.ypp.
sql_transaction_stmt:
    BEGIN_P sql_opt_transaction sql_transaction_modes {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, enum_node(@1, TransactionCommand::BEGIN)),
            attr(Key::SQL_TRANSACTION_MODES, $3),
        ])
    }
  | START TRANSACTION sql_transaction_modes {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, enum_node(@1, TransactionCommand::START)),
            attr(Key::SQL_TRANSACTION_MODES, $3),
        ])
    }
  | sql_transaction_end sql_opt_transaction {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[attr(Key::SQL_TRANSACTION_COMMAND, $1)])
    }
  | ROLLBACK sql_opt_transaction sql_transaction_rollback_target {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, enum_node(@1, TransactionCommand::ROLLBACK)),
            attr(Key::SQL_TRANSACTION_TARGET, $3),
        ])
    }
  | SAVEPOINT sql_col_id {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, enum_node(@1, TransactionCommand::SAVEPOINT)),
            attr(Key::SQL_TRANSACTION_TARGET, $2),
        ])
    }
  | RELEASE sql_transaction_savepoint {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, enum_node(@1, TransactionCommand::RELEASE)),
            attr(Key::SQL_TRANSACTION_TARGET, $2),
        ])
    }
  | PREPARE TRANSACTION SCONST {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, enum_node(@1, TransactionCommand::PREPARE)),
            attr(Key::SQL_TRANSACTION_TARGET, const_node(@3, AConstType::STRING)),
            attr(Key::SQL_TRANSACTION_PREPARED, bool_node(@2, true)),
        ])
    }
  | COMMIT PREPARED SCONST {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, enum_node(@1, TransactionCommand::COMMIT)),
            attr(Key::SQL_TRANSACTION_TARGET, const_node(@3, AConstType::STRING)),
            attr(Key::SQL_TRANSACTION_PREPARED, bool_node(@2, true)),
        ])
    }
  | ROLLBACK PREPARED SCONST {
        ctx.object(@$, NodeType::OBJECT_SQL_TRANSACTION, &[
            attr(Key::SQL_TRANSACTION_COMMAND, enum_node(@1, TransactionCommand::ROLLBACK)),
            attr(Key::SQL_TRANSACTION_TARGET, const_node(@3, AConstType::STRING)),
            attr(Key::SQL_TRANSACTION_PREPARED, bool_node(@2, true)),
        ])
    }
    ;

sql_transaction_end:
    COMMIT   { enum_node(@1, TransactionCommand::COMMIT) }
  | END_P    { enum_node(@1, TransactionCommand::END) }
  | ABORT_P  { enum_node(@1, TransactionCommand::ABORT) }
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
    READ_P UNCOMMITTED { enum_node(@$, TransactionIsolationLevel::READ_UNCOMMITTED) }
  | READ_P COMMITTED   { enum_node(@$, TransactionIsolationLevel::READ_COMMITTED) }
  | REPEATABLE READ_P  { enum_node(@$, TransactionIsolationLevel::REPEATABLE_READ) }
  | SERIALIZABLE       { enum_node(@$, TransactionIsolationLevel::SERIALIZABLE) }
    ;
