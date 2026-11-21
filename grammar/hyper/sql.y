// Hyper SQL syntax, without engine semantic actions. See README.md.
%require "3.3"
%define api.token.raw true
%token EOF 0
%token IDENT FCONST SCONST BCONST XCONST Op ICONST PARAM TYPECAST COLON_EQUALS EQUALS_GREATER ABORT_P
%token ABSOLUTE_P ABSENT ACCESS ACTION ADD_P ADMIN AFTER AGGREGATE AGGREGATION_THRESHOLD ALL ALSO ALTER ALWAYS
%token ANALYSE ANALYZE AND ANY ARE ARRAY AS ASC ASSERTION ASSIGNMENT ASSUMED ASYMMETRIC AT ATTACH ATTRIBUTE
%token AUTHORIZATION BACKWARD BEFORE BEGIN_P BETWEEN BIGINT BINARY BIT BOUNDED BOOLEAN_P BOTH BUFFERED BULK BY
%token CACHE CALL CALLED CASCADE CASCADED CASE CAST CATALOG_P CHAIN CHARACTER CHARACTERISTICS CHAR_P CHECK
%token CHECKPOINT CLASS CLOSE CLUSTER COALESCE COLLATE COLLATION COLUMN COLUMNS COMMENT COMMENTS COMMIT
%token COMMITTED CONCURRENTLY CONDITIONAL CONFIGURATION CONNECTION CONSTRAINT CONSTRAINTS CONTENT_P CONTINUE_P
%token CONVERSION_P COPY COST CREATE CROSS CSV CUBE CURRENT_CATALOG CURRENT_DATE CURRENT_P CURRENT_ROLE
%token CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR CYCLE CONSTREF DATABASE DATA_P DAY_P
%token DEALLOCATE DEC DECIMAL_P DECLARE DEFAULT DEFAULTS DEFERRABLE DEFERRED DEFINER DELETE_P DELIMITER
%token DELIMITERS DESC DESCRIPTOR DESTINATION DETACH DICTIONARY DIMENSIONS DISABLE_P DISCARD DISTINCT DO
%token DOCUMENT_P DOMAIN_P DOUBLE_P DROP EACH EDGE ELSE ENABLE_P ENCODING ENCRYPTED END_P ENUM_P ERROR_P
%token ESCAPE EVENT EXCEPT EXCLUDE EXCLUDING EXCLUSIVE EXECUTE EXISTS EXPLAIN EXPORT EXTENSION EXTERNAL
%token EXTRACT FALSE_P FACTS FAMILY FETCH FILTER FIRST_P FLOAT_P FOLLOWING FOR FORMAT FORCE FOREIGN FORWARD
%token FREEZE FROM FULL FUNCTION FUNCTIONS GLOBAL GRANT GRANTED GRAPH GRAPH_TABLE GREATEST GROUP_P GROUPING
%token GROUPS HANDLER HAVING HEADER_P HOLD HOUR_P IDENTITY_P IF_P IGNORE ILIKE IMMEDIATE IMMUTABLE IMPLICIT_P
%token IMPORT_P INCLUDING INCREMENT INDEX INDEXES INHERIT INHERITS INITIALLY INLINE_P INNER_P INOUT INPUT_P
%token INSENSITIVE INSERT INSTEAD INTEGER INTERSECT INTERVAL INTO INT_P INVOKER IN_P IS ISNULL ISOLATION JOIN
%token JSON JSON_ARRAY JSON_EXISTS JSON_OBJECT JSON_QUERY JSON_SCALAR JSON_VALUE KEY KEYS LABEL LANGUAGE
%token LARGE_P LAST_P LATERAL_P LEADING LEAKPROOF LEAST LEFT LEVEL LIKE LIMIT LISTEN LOAD LOCAL LOCALTIME
%token LOCALTIMESTAMP LOCATION LOCKED LOCK_P LOGGED MAPPING MATCH MATCHED MATERIALIZED MAXVALUE MEASURES MERGE
%token MINUTE_P MINVALUE MODE MONTH_P MOVE NAMES NAME_P NATIONAL NATURAL NCHAR NEXT NO NODE NONE NOT NOTHING
%token NOTIFY NOTNULL NOWAIT NTH_VALUE NULLIF NULLS_P NULL_P NUMERIC OBJECT_P OF OFF OFFSET OIDS OMIT ON ONE
%token ONLY OPERATOR OPTION OPTIONS OR ORDER ORDINALITY OTHERS OUTER_P OUT_P OVER OVERLAPS OVERLAY OWNED OWNER
%token PARSER PARTIAL PARTITION PASSING PASSWORD PER PLACING PLANS POLICY POSITION PRECEDING PRECISION PREPARE
%token PREPARED PRESERVE PRIMARY PRIOR PRIVILEGES PROCEDURAL PROCEDURE PROGRAM PROPERTIES PROPERTY QUOTE
%token QUOTES RANGE READ REAL REASSIGN RECHECK RECURSIVE REF REFERENCES REFRESH REINDEX RELATIVE_P
%token RELATIONSHIP RELEASE RENAME REPEATABLE REPLACE REPLICA RESET RESPECT RESTART RESTRICT RETURNING RETURNS
%token REVOKE RIGHT ROLE ROLLBACK ROLLUP ROW ROWS RULE SANITIZE SAVEPOINT SCALAR SCHEMA SCROLL SEARCH SECOND_P
%token SECURE SECURITY SELECT SEMANTICS SEQUENCE SEQUENCES SERIALIZABLE SERVER SESSION SESSION_USER SET SETOF
%token SETS SHARE SHOW SIMILAR SIMPLE SKIP SMALLINT SNAPSHOT SOME SOURCE STABLE STANDALONE_P START STATEMENT
%token STATISTICS STDIN STDOUT STEP STORAGE STRICT_P STRIP_P SUBSTRING SYMMETRIC SYSID SYSTEM_P TABLE TABLES
%token TABLESAMPLE TABLESPACE TARGET TEMP TEMPLATE TEMPORARY TEXT_P THEN TIES TIME TIMESTAMP TO TRAILING
%token TRANSACTION TREAT TRIGGER TRIM TRY_CAST TRUE_P TRUNCATE TRUSTED TYPES_P TYPE_P UNBOUNDED UNCOMMITTED
%token UNCONDITIONAL UNENCRYPTED UNION UNIQUE UNKNOWN UNLISTEN UNLOGGED UNTIL UPDATE USER USING VACUUM VALID
%token VALIDATE VALIDATOR VALUES VALUE_P VARCHAR VARIADIC VARYING VERBOSE VERSION_P VIEW VIEWS VOLATILE WHEN
%token WHERE WHITESPACE_P WINDOW WITH WITHIN WITHOUT WORK WRAPPER WRITE XMLATTRIBUTES XMLCONCAT XMLELEMENT
%token XMLEXISTS XMLFOREST XMLPARSE XMLPI XMLROOT XMLSERIALIZE XML_P YEAR_P YES_P ZONE BREAK_P CARDINALITY
%token CONST DEFRAGMENTATION EMPTY EXPRESSIONS FORCEFULLY GRACEFULLY KEEP PASS PERCENT PRUNE RETURN_P STREAM
%token THROUGH THROUGHS THROW UNLOAD VAR VERTEX WHILE YIELD LAMBDA GREATER_EQUALS LESS_EQUALS NOT_EQUALS
%token NOT_LA NULLS_LA WITH_LA WITH_OPTIONS_LA WITHOUT_LA ARRAY_LA FORMAT_LA DOT_LA LRB RRB LSB RSB LCB RCB
%token SEMICOLON COMMA COLON DOT PLUS MINUS STAR DIVIDE MODULO CIRCUMFLEX LESS_THAN GREATER_THAN EQUALS
%token AMPERSAND PIPE EXCLAMATION_MARK QUESTION_MARK
%nonassoc EXTERNAL
%nonassoc STREAM
%nonassoc SET
%left UNION EXCEPT
%left INTERSECT
%left OR
%left AND
%right NOT
%nonassoc IS ISNULL NOTNULL
%nonassoc LESS_THAN GREATER_THAN EQUALS LESS_EQUALS GREATER_EQUALS NOT_EQUALS
%nonassoc BETWEEN IN_P LIKE ILIKE SIMILAR NOT_LA
%nonassoc ESCAPE
%nonassoc OVERLAPS
%nonassoc UNBOUNDED
%nonassoc IDENT NULL_P PARTITION RANGE ROWS GROUPS PRECEDING FOLLOWING CUBE ROLLUP LAMBDA
%left Op OPERATOR AMPERSAND PIPE
%left PLUS MINUS
%left STAR DIVIDE MODULO
%left CIRCUMFLEX
%left AT
%left COLLATE
%right UMINUS
%left LSB RSB
%left LRB RRB
%left TYPECAST
%left DOT
%left JOIN CROSS LEFT FULL RIGHT INNER_P NATURAL
%right PRESERVE STRIP_P
%nonassoc EMPTY_PREC
%nonassoc ORDER
%start Stmt
%%
Stmt:
    AlterDbStmt
  | AlterGroupStmt
  | AlterRoleSetStmt
  | AlterRoleStmt
  | AlterSeqStmt
  | AlterTableStmt
  | AlterUserSetStmt
  | AlterUserStmt
  | AnalyzeStmt
  | AttachDbStmt
  | CallStmt
  | ClosePortalStmt
  | CloseExternalStreamStmt
  | CommentStmt
  | CopyStmt
  | CreateAsStmt
  | CreateDbStmt
  | CreateDbFromStmt
  | CreateFunctionStmt
  | CreateGroupStmt
  | CreateIndexStmt
  | CreateRoleStmt
  | CreateSchemaStmt
  | CreateSeqStmt
  | CreateTableStmt
  | CreateExternalStreamStmt
  | CreateExternalTableStmt
  | CreateUserStmt
  | DeallocateStmt
  | DeclareCursorStmt
  | DefineStmt
  | DeleteStmt
  | DetachDbStmt
  | DropDbStmt
  | DropFuncStmt
  | DropGroupStmt
  | DropRoleStmt
  | DropStmt
  | DropUserStmt
  | ExecuteStmt
  | ExplainStmt
  | ExportDbStmt
  | FetchStmt
  | GrantRoleStmt
  | GrantStmt
  | ImportDbStmt
  | InsertStmt
  | MergeStmt
  | PrepareStmt
  | RenameStmt
  | RevokeRoleStmt
  | RevokeStmt
  | SelectStmt
  | TransactionStmt
  | TruncateStmt
  | UpdateStmt
  | ValidateStmt
  | VariableResetStmt
  | VariableSetStmt
  | VariableShowStmt
  | ViewStmt
  | UnloadDbStmt
  | UnloadReleaseStmt
    ;
source_descriptor:
    nestable_external_location_descriptor
  | ARRAY LSB RSB
  | ARRAY LSB array_external_location_descriptor_list RSB
    ;
nestable_external_location_descriptor:
    Sconst
  | IDENT LRB RRB
  | IDENT LRB func_arg_list RRB
  | PROGRAM Sconst
    ;
array_external_location_descriptor_list:
    nestable_external_location_descriptor
  | array_external_location_descriptor_list COMMA nestable_external_location_descriptor
    ;
AlterDbStmt:
    ALTER opt_db_locality DATABASE database_name opt_with createdb_opt_list SET generic_set
    ;
AlterRoleStmt:
    ALTER ROLE qualified_name opt_with AlterOptRoleList
    ;
opt_in_database:
    %empty
  | IN_P DATABASE database_name
    ;
AlterRoleSetStmt:
    ALTER ROLE qualified_name opt_in_database SetResetClause
  | ALTER ROLE ALL opt_in_database SetResetClause
    ;
AlterUserStmt:
    ALTER USER qualified_name opt_with AlterOptRoleList
    ;
AlterUserSetStmt:
    ALTER USER qualified_name SetResetClause
    ;
AlterGroupStmt:
    ALTER GROUP_P qualified_name ADD_P USER role_list
  | ALTER GROUP_P qualified_name DROP USER role_list
    ;
CommentStmt:
    COMMENT ON COLUMN any_name IS comment_text
    ;
comment_text:
    Sconst
  | NULL_P
    ;
CopyStmt:
    COPY opt_binary qualified_name opt_column_list opt_oids FROM copy_source_descriptor copy_delimiter opt_with copy_options
  | COPY opt_binary qualified_name opt_column_list opt_oids TO copy_target_descriptor copy_delimiter opt_with copy_options opt_partition_clause
  | COPY select_with_parens TO copy_target_descriptor opt_with copy_options opt_partition_clause
    ;
copy_source_descriptor:
    source_descriptor
  | STDIN
    ;
copy_target_descriptor:
    nestable_external_location_descriptor
  | STDOUT
  | NULL_P
    ;
copy_options:
    copy_opt_list
  | LRB copy_generic_opt_list RRB
    ;
copy_opt_list:
    copy_opt_list copy_opt_item
  | %empty
    ;
copy_opt_item:
    BINARY
  | OIDS
  | FREEZE
  | DELIMITER opt_as Sconst
  | NULL_P opt_as Sconst
  | CSV
  | HEADER_P
  | QUOTE opt_as Sconst
  | ESCAPE opt_as Sconst
  | FORCE QUOTE columnList
  | FORCE QUOTE STAR
  | FORCE NOT NULL_P columnList
  | FORCE NULL_P columnList
  | ENCODING Sconst
  | SANITIZE
    ;
opt_with:
    WITH
  | WITH_LA
  | %empty
    ;
opt_as:
    AS
  | %empty
    ;
opt_binary:
    BINARY
  | %empty
    ;
opt_oids:
    WITH OIDS
  | %empty
    ;
copy_delimiter:
    opt_using DELIMITERS Sconst
  | %empty
    ;
opt_using:
    USING
  | %empty
    ;
copy_generic_opt_list:
    postgres_copy_generic_opt_list
  | hyper_copy_opt_list
    ;
hyper_copy_opt_list:
    hyper_copy_opt_elem
  | hyper_copy_opt_list COMMA hyper_copy_opt_elem
    ;
hyper_copy_opt_elem:
    param_name COLON_EQUALS func_arg_expr
  | param_name EQUALS_GREATER func_arg_expr
    ;
postgres_copy_generic_opt_list:
    postgres_copy_generic_opt_elem
  | postgres_copy_generic_opt_list COMMA postgres_copy_generic_opt_elem
    ;
postgres_copy_generic_opt_elem:
    ColLabel copy_generic_opt_arg
  | FORMAT_LA copy_generic_opt_arg
    ;
copy_generic_opt_arg:
    opt_boolean_or_string
  | NumericOnly
  | STAR
  | LRB copy_generic_opt_arg_list RRB
  | %empty
    ;
copy_generic_opt_arg_list:
    copy_generic_opt_arg_list_item
  | copy_generic_opt_arg_list COMMA copy_generic_opt_arg_list_item
    ;
copy_generic_opt_arg_list_item:
    opt_boolean_or_string
    ;
opt_boolean_or_string:
    TRUE_P
  | FALSE_P
  | ON
  | NonReservedWord_or_Sconst
    ;
NonReservedWord_or_Sconst:
    NonReservedWord
  | Sconst
    ;
NumericOnly:
    FCONST
  | MINUS FCONST
  | SignedIconst
    ;
NumericOnly_list:
    NumericOnly
  | NumericOnly_list COMMA NumericOnly
    ;
CreateAsStmt:
    CREATE OptTemp TABLE create_as_target OptCommit AS SelectStmt opt_with_data
  | CREATE OptTemp TABLE IF_P NOT EXISTS create_as_target OptCommit AS SelectStmt opt_with_data
    ;
create_as_target:
    qualified_name opt_column_list OptWith
    ;
opt_with_data:
    WITH DATA_P
  | WITH NO DATA_P
  | %empty
    ;
ImportDbStmt:
    IMPORT_P opt_db_locality DATABASE database_name opt_with createdb_opt_list FROM import_source_descriptor opt_with createdb_opt_list
  | IMPORT_P opt_db_locality DATABASE IF_P NOT EXISTS database_name opt_with createdb_opt_list FROM import_source_descriptor opt_with createdb_opt_list
    ;
import_source_descriptor:
    nestable_external_location_descriptor
  | STDIN
    ;
ExportDbStmt:
    EXPORT opt_db_locality DATABASE database_name opt_with createdb_opt_list TO copy_target_descriptor opt_with createdb_opt_list
    ;
CreateDbFromStmt:
    CREATE opt_db_locality DATABASE database_name opt_with createdb_opt_list FROM database_name opt_with createdb_opt_list
  | CREATE opt_db_locality DATABASE IF_P NOT EXISTS database_name opt_with createdb_opt_list FROM database_name opt_with createdb_opt_list
    ;
opt_db_locality:
    LOCAL
  | %empty
    ;
CreateDbStmt:
    CREATE opt_db_locality DATABASE database_name opt_with createdb_opt_list
  | CREATE opt_db_locality DATABASE IF_P NOT EXISTS database_name opt_with createdb_opt_list
    ;
createdb_opt_list:
    createdb_opt_items
  | %empty
    ;
createdb_opt_items:
    createdb_opt_item
  | createdb_opt_items createdb_opt_item
    ;
createdb_opt_item:
    createdb_opt_name opt_equal SignedIconst
  | createdb_opt_name opt_equal opt_boolean_or_string
    ;
createdb_opt_name:
    IDENT
  | VERSION_P
  | CONNECTION LIMIT
  | ENCODING
  | LOCATION
  | OWNER
  | TABLESPACE
  | TEMPLATE
    ;
opt_equal:
    EQUALS
  | %empty
    ;
AttachDbStmt:
    ATTACH opt_db_locality DATABASE database_name AS database_name opt_attach_database_options
    ;
opt_attach_database_options:
    WITH LRB attachdb_opt_items RRB
  | %empty
    ;
attachdb_opt_items:
    attachdb_opt_item
  | attachdb_opt_items COMMA attachdb_opt_item
    ;
attachdb_opt_item:
    NonReservedWord_or_Sconst EQUALS NonReservedWord_or_Sconst
  | NonReservedWord_or_Sconst EQUALS DEFAULT
    ;
DetachDbStmt:
    DETACH DATABASE database_name_list
  | DETACH DATABASE STAR
    ;
database_name_list:
    database_name
  | database_name_list COMMA database_name
    ;
UnloadDbStmt:
    UNLOAD opt_db_locality DATABASE database_name opt_unload_defragment
  | UNLOAD opt_db_locality DATABASE database_name FORCEFULLY opt_unload_defragment
  | UNLOAD opt_db_locality DATABASE database_name GRACEFULLY opt_unload_defragment
    ;
opt_unload_defragment:
    WITH DEFRAGMENTATION
  | %empty
    ;
UnloadReleaseStmt:
    UNLOAD RELEASE
    ;
CreateFunctionStmt:
    CREATE OptTemp FUNCTION func_name func_args_with_defaults RETURNS func_arg_type createfunc_opt_list opt_definition
  | CREATE OptTemp FUNCTION func_name func_args_with_defaults RETURNS func_arg_type NOT NULL_P createfunc_opt_list opt_definition
  | CREATE OptTemp FUNCTION func_name func_args_with_defaults createfunc_opt_list opt_definition
  | CREATE OR REPLACE OptTemp FUNCTION func_name func_args_with_defaults RETURNS func_arg_type createfunc_opt_list opt_definition
  | CREATE OR REPLACE OptTemp FUNCTION func_name func_args_with_defaults RETURNS func_arg_type NOT NULL_P createfunc_opt_list opt_definition
  | CREATE OR REPLACE OptTemp FUNCTION func_name func_args_with_defaults createfunc_opt_list opt_definition
    ;
func_args:
    LRB func_args_list RRB
  | LRB RRB
    ;
func_args_list:
    func_arg
  | func_args_list COMMA func_arg
    ;
func_args_with_defaults:
    LRB func_args_with_defaults_list RRB
  | LRB RRB
    ;
func_args_with_defaults_list:
    func_arg_with_default
  | func_args_with_defaults_list COMMA func_arg_with_default
    ;
func_arg_type:
    Typename
  | table_column_type
  | SETOF table_column_type
  | TABLE LRB opt_table_func_column_list RRB opt_table_pass_through opt_table_arg_semantics
  | TABLE opt_table_pass_through opt_table_arg_semantics
  | ONLY PASS THROUGHS
    ;
func_arg:
    arg_class param_name func_arg_type opt_not_null
  | param_name arg_class func_arg_type opt_not_null
  | param_name func_arg_type opt_not_null
  | arg_class func_arg_type opt_not_null
  | func_arg_type opt_not_null
    ;
arg_class:
    IN_P
  | OUT_P
  | INOUT
  | IN_P OUT_P
  | VARIADIC
  | CONST
  | CONSTREF
    ;
func_arg_with_default:
    func_arg
  | func_arg DEFAULT a_expr
  | func_arg EQUALS a_expr
    ;
createfunc_opt_list:
    createfunc_opt_item
  | createfunc_opt_list createfunc_opt_item
    ;
common_func_opt_item:
    CALLED ON NULL_P INPUT_P
  | RETURNS NULL_P ON NULL_P INPUT_P
  | STRICT_P
  | IMMUTABLE
  | STABLE
  | VOLATILE
  | EXTERNAL SECURITY DEFINER
  | EXTERNAL SECURITY INVOKER
  | SECURITY DEFINER
  | SECURITY INVOKER
  | LEAKPROOF
  | NOT LEAKPROOF
  | COST NumericOnly
  | ROWS NumericOnly
  | FunctionSetResetClause
    ;
opt_table_pass_through:
    %empty
  | PASS THROUGH
  | NO PASS THROUGH
    ;
opt_table_arg_semantics:
    %empty
  | WITH ROW SEMANTICS
  | WITH SET SEMANTICS opt_table_arg_pruning
    ;
opt_table_arg_pruning:
    %empty
  | KEEP WHEN EMPTY
  | PRUNE WHEN EMPTY
    ;
createfunc_opt_item:
    AS func_as
  | LANGUAGE NonReservedWord_or_Sconst
  | WINDOW
  | common_func_opt_item
    ;
func_as:
    Sconst
  | func_as COMMA Sconst
    ;
table_func_column:
    param_name Typename opt_not_null
    ;
table_func_column_list:
    table_func_column
  | table_func_column_list COMMA table_func_column
    ;
opt_table_func_column_list:
    table_func_column_list
  | %empty
    ;
CreateIndexStmt:
    CREATE opt_unique INDEX opt_concurrently opt_index_name ON qualified_name access_method_clause LRB index_params RRB opt_reloptions
  | CREATE opt_unique INDEX opt_concurrently IF_P NOT EXISTS opt_index_name ON qualified_name access_method_clause LRB index_params RRB opt_reloptions
    ;
opt_unique:
    UNIQUE
  | %empty
    ;
opt_concurrently:
    CONCURRENTLY
  | %empty
    ;
opt_index_name:
    index_name
  | %empty
    ;
access_method_clause:
    USING access_method
  | %empty
    ;
index_params:
    index_elem
  | index_params COMMA index_elem
    ;
index_elem:
    ColId opt_collate opt_class opt_asc_desc opt_nulls_order
    ;
opt_collate:
    COLLATE any_name
  | %empty
    ;
opt_class:
    any_name
  | %empty
    ;
opt_asc_desc:
    ASC
  | DESC
  | %empty
    ;
opt_nulls_order:
    NULLS_LA FIRST_P
  | NULLS_LA LAST_P
  | %empty
    ;
reloptions:
    LRB reloption_list RRB
    ;
opt_reloptions:
    WITH reloptions
  | %empty
    ;
reloption_list:
    reloption_elem
  | reloption_list COMMA reloption_elem
    ;
reloption_elem:
    ColLabel EQUALS def_arg
  | ColLabel
  | ColLabel DOT ColLabel EQUALS def_arg
  | ColLabel DOT ColLabel
    ;
CreateRoleStmt:
    CREATE ROLE qualified_name opt_with OptRoleList
    ;
OptRoleList:
    OptRoleList CreateOptRoleElem
  | %empty
    ;
AlterOptRoleList:
    AlterOptRoleList AlterOptRoleElem
  | %empty
    ;
AlterOptRoleElem:
    PASSWORD Sconst
  | PASSWORD NULL_P
  | ENCRYPTED PASSWORD Sconst
  | UNENCRYPTED PASSWORD Sconst
  | INHERIT
  | CONNECTION LIMIT SignedIconst
  | VALID UNTIL Sconst
  | IDENT
    ;
CreateOptRoleElem:
    AlterOptRoleElem
  | ADMIN role_list
  | ROLE role_list
  | IN_P ROLE role_list
    ;
CreateUserStmt:
    CREATE USER qualified_name opt_with OptRoleList
    ;
CreateGroupStmt:
    CREATE GROUP_P qualified_name opt_with OptRoleList
    ;
CreateSchemaStmt:
    CREATE SCHEMA OptSchemaName AUTHORIZATION RoleId OptSchemaEltList
  | CREATE SCHEMA qualified_name OptSchemaEltList
  | CREATE SCHEMA IF_P NOT EXISTS OptSchemaName AUTHORIZATION RoleId OptSchemaEltList
  | CREATE SCHEMA IF_P NOT EXISTS qualified_name OptSchemaEltList
    ;
OptSchemaName:
    qualified_name
  | %empty
    ;
OptSchemaEltList:
    OptSchemaEltList schema_stmt
  | %empty
    ;
schema_stmt:
    CreateTableStmt
  | CreateExternalStreamStmt
  | CreateExternalTableStmt
  | CreateIndexStmt
  | CreateSeqStmt
  | GrantStmt
  | ViewStmt
    ;
CreateSeqStmt:
    CREATE OptTemp SEQUENCE qualified_name opt_SequenceOptionList
  | CREATE OptTemp SEQUENCE IF_P NOT EXISTS qualified_name opt_SequenceOptionList
    ;
opt_SequenceOptionList:
    SequenceOptionList
  | %empty
    ;
SequenceOptionList:
    SequenceOptionItem
  | SequenceOptionList SequenceOptionItem
    ;
SequenceOptionItem:
    AS Numeric
  | INCREMENT SignedIconst
  | INCREMENT BY SignedIconst
  | MINVALUE SignedIconst
  | NO MINVALUE
  | MAXVALUE SignedIconst
  | NO MAXVALUE
  | START SignedIconst
  | START WITH SignedIconst
  | RESTART SignedIconst
  | RESTART WITH SignedIconst
  | RESTART
  | CACHE SignedIconst
  | CYCLE
  | NO CYCLE
  | OWNED BY columnref
    ;
AlterSeqStmt:
    ALTER SEQUENCE qualified_name opt_SequenceOptionList
  | ALTER SEQUENCE IF_P EXISTS qualified_name opt_SequenceOptionList
    ;
CreateTableStmt:
    CREATE OptTemp TABLE qualified_name LRB OptTableElementList RRB OptWith OptCommit
  | CREATE OptTemp TABLE IF_P NOT EXISTS qualified_name LRB OptTableElementList RRB OptWith OptCommit
    ;
OptTemp:
    TEMPORARY
  | TEMP
  | LOCAL TEMPORARY
  | LOCAL TEMP
  | GLOBAL TEMPORARY
  | GLOBAL TEMP
  | UNLOGGED
  | %empty
    ;
OptTableElementList:
    TableElementList
  | %empty
    ;
TableElementList:
    TableElement
  | TableElementList COMMA TableElement
    ;
TableElement:
    columnDef
  | TableLikeClause
  | TableConstraint
    ;
columnDef:
    ColId Typename create_generic_options ColQualList
    ;
OptCommit:
    ON COMMIT DROP
  | ON COMMIT DELETE_P ROWS
  | ON COMMIT PRESERVE ROWS
  | %empty
    ;
create_generic_options:
    OPTIONS LRB generic_option_list RRB
  | %empty
    ;
generic_option_list:
    generic_option_elem
  | generic_option_list COMMA generic_option_elem
    ;
generic_option_elem:
    generic_option_name generic_option_arg
    ;
generic_option_name:
    ColLabel
    ;
generic_option_arg:
    Sconst
    ;
ColQualList:
    ColQualList ColConstraint
  | %empty
    ;
ColConstraint:
    CONSTRAINT name ColConstraintElem
  | ColConstraintElem
  | ConstraintAttr
  | COLLATE any_name
    ;
ColConstraintElem:
    NOT NULL_P
  | NULL_P
  | UNIQUE opt_definition
  | PRIMARY KEY opt_definition
  | CHECK LRB a_expr RRB
  | DEFAULT b_expr
  | REFERENCES qualified_name opt_column_list key_match key_actions
  | ASSUMED UNIQUE opt_definition
  | ASSUMED PRIMARY KEY opt_definition
  | ASSUMED REFERENCES qualified_name opt_column_list key_match key_actions
    ;
ConstraintAttr:
    DEFERRABLE
  | NOT DEFERRABLE
  | INITIALLY DEFERRED
  | INITIALLY IMMEDIATE
    ;
TableLikeClause:
    LIKE qualified_name TableLikeOptionList
    ;
TableLikeOptionList:
    TableLikeOptionList INCLUDING TableLikeOption
  | TableLikeOptionList EXCLUDING TableLikeOption
  | %empty
    ;
TableLikeOption:
    DEFAULT
  | CONSTRAINTS
  | INDEXES
  | STORAGE
  | COMMENTS
  | ALL
    ;
TableConstraint:
    CONSTRAINT name ConstraintElem
  | ConstraintElem
    ;
ConstraintElem:
    CHECK LRB a_expr RRB ConstraintAttributeSpec
  | UNIQUE LRB columnList RRB opt_definition ConstraintAttributeSpec
  | PRIMARY KEY LRB columnList RRB opt_definition ConstraintAttributeSpec
  | FOREIGN KEY LRB columnList RRB REFERENCES qualified_name opt_column_list key_match key_actions ConstraintAttributeSpec
  | ASSUMED UNIQUE LRB columnList RRB opt_definition ConstraintAttributeSpec
  | ASSUMED PRIMARY KEY LRB columnList RRB opt_definition ConstraintAttributeSpec
  | ASSUMED FOREIGN KEY LRB columnList RRB REFERENCES qualified_name opt_column_list key_match key_actions ConstraintAttributeSpec
    ;
ConstraintAttributeSpec:
    %empty
  | ConstraintAttributeSpec ConstraintAttributeElem
    ;
ConstraintAttributeElem:
    NOT DEFERRABLE
  | DEFERRABLE
  | INITIALLY IMMEDIATE
  | INITIALLY DEFERRED
  | NOT VALID
  | NO INHERIT
    ;
opt_column_list:
    LRB columnList RRB
  | %empty
    ;
columnList:
    columnElem
  | columnList COMMA columnElem
    ;
columnElem:
    ColId
    ;
key_match:
    MATCH FULL
  | MATCH PARTIAL
  | MATCH SIMPLE
  | %empty
    ;
key_actions:
    key_update
  | key_delete
  | key_update key_delete
  | key_delete key_update
  | %empty
    ;
key_update:
    ON UPDATE key_action
    ;
key_delete:
    ON DELETE_P key_action
    ;
key_action:
    NO ACTION
  | RESTRICT
  | CASCADE
  | SET NULL_P
  | SET DEFAULT
    ;
OptWith:
    WITH reloptions
  | %empty
    ;
opt_definition:
    WITH definition
  | %empty
    ;
definition:
    LRB def_list RRB
    ;
def_list:
    def_elem
  | def_list COMMA def_elem
    ;
def_elem:
    ColLabel EQUALS def_arg
  | ColLabel
    ;
def_arg:
    Typename
  | table_column_type
  | reserved_keyword
  | qual_all_Op
  | NumericOnly
  | Sconst
    ;
param_name:
    type_function_name
    ;
table_column_type:
    type_function_name attrs MODULO TYPE_P
    ;
function_with_argtypes:
    func_name func_args
    ;
aggr_arg:
    func_arg
    ;
aggr_args:
    LRB STAR RRB
  | LRB aggr_args_list RRB
  | LRB ORDER BY aggr_args_list RRB
  | LRB aggr_args_list ORDER BY aggr_args_list RRB
    ;
aggr_args_list:
    aggr_arg
  | aggr_args_list COMMA aggr_arg
    ;
CreateExternalStreamStmt:
    CREATE OptTemp StreamType qualified_name ExternalStreamSchema opt_external_stream_options
  | CREATE OptTemp StreamType IF_P NOT EXISTS qualified_name ExternalStreamSchema opt_external_stream_options
    ;
StreamType:
    BOUNDED EXTERNAL STREAM
  | BUFFERED EXTERNAL STREAM
  | EXTERNAL STREAM
    ;
opt_external_stream_options:
    LRB opt_with copy_options RRB
  | WITH LRB hyper_copy_opt_list RRB
  | %empty
    ;
ExternalStreamSchema:
    LIKE qualified_name
  | LRB columnDef_list RRB
  | LRB RRB
    ;
CreateExternalTableStmt:
    CREATE OptTemp EXTERNAL TABLE qualified_name ExternalTableSchema FOR source_descriptor
  | CREATE OptTemp EXTERNAL TABLE IF_P NOT EXISTS qualified_name ExternalTableSchema FOR source_descriptor
  | CREATE OptTemp EXTERNAL TABLE qualified_name ExternalTableSchema FOR source_descriptor LRB opt_with copy_options RRB
  | CREATE OptTemp EXTERNAL TABLE IF_P NOT EXISTS qualified_name ExternalTableSchema FOR source_descriptor LRB opt_with copy_options RRB
  | CREATE OptTemp EXTERNAL TABLE qualified_name ExternalTableSchema FOR source_descriptor WITH LRB hyper_copy_opt_list RRB
  | CREATE OptTemp EXTERNAL TABLE IF_P NOT EXISTS qualified_name ExternalTableSchema FOR source_descriptor WITH LRB hyper_copy_opt_list RRB
    ;
ExternalTableSchema:
    LIKE qualified_name
  | LRB columnDef_list RRB
  | LRB RRB
  | %empty
    ;
alter_table_cmd:
    ADD_P opt_column columnDef
  | ADD_P opt_column IF_P NOT EXISTS columnDef
  | DROP opt_column ColId
  | DROP opt_column ColId IF_P EXISTS
  | ADD_P TableConstraint
  | DROP CONSTRAINT IF_P EXISTS name
  | DROP CONSTRAINT name
    ;
alter_table_cmds:
    alter_table_cmd
  | alter_table_cmds COMMA alter_table_cmd
    ;
AlterTableStmt:
    ALTER TABLE relation_expr alter_table_cmds
  | ALTER TABLE IF_P EXISTS relation_expr alter_table_cmds
    ;
DefineStmt:
    CREATE OptTemp AGGREGATE func_name aggr_args definition
  | CREATE OptTemp AGGREGATE func_name old_aggr_definition
  | CREATE OptTemp OPERATOR any_operator definition
  | CREATE OptTemp TYPE_P any_name definition
  | CREATE OptTemp TYPE_P any_name
  | CREATE OptTemp TYPE_P any_name AS LRB OptTableFuncElementList RRB
  | CREATE OptTemp TYPE_P any_name AS ENUM_P LRB opt_enum_val_list RRB
  | CREATE OptTemp TYPE_P any_name AS RANGE definition
  | CREATE OptTemp DOMAIN_P any_name AS Typename
  | CREATE OptTemp DOMAIN_P any_name AS Typename WITH LRB domain_arg_list RRB
  | CREATE TEXT_P SEARCH PARSER any_name definition
  | CREATE TEXT_P SEARCH DICTIONARY any_name definition
  | CREATE TEXT_P SEARCH TEMPLATE any_name definition
  | CREATE TEXT_P SEARCH CONFIGURATION any_name definition
  | CREATE COLLATION any_name definition
  | CREATE COLLATION any_name FROM any_name
    ;
domain_arg_list:
    domain_arg
  | domain_arg_list COMMA domain_arg
    ;
domain_constant_expr:
    SignedIconst
  | TRUE_P
  | FALSE_P
  | Sconst
    ;
domain_arg:
    param_name COLON_EQUALS domain_constant_expr
  | param_name EQUALS_GREATER domain_constant_expr
    ;
old_aggr_definition:
    LRB old_aggr_list RRB
    ;
old_aggr_list:
    old_aggr_elem
  | old_aggr_list COMMA old_aggr_elem
    ;
old_aggr_elem:
    IDENT EQUALS def_arg
    ;
opt_enum_val_list:
    enum_val_list
  | %empty
    ;
enum_val_list:
    Sconst
  | enum_val_list COMMA Sconst
    ;
DeleteStmt:
    opt_with_clause DELETE_P FROM relation_expr_opt_alias where_or_current_clause returning_clause
  | opt_with_clause DELETE_P FROM relation_expr_opt_alias USING from_list where_or_current_clause returning_clause
    ;
DropDbStmt:
    DROP opt_db_locality DATABASE database_name
  | DROP opt_db_locality DATABASE IF_P EXISTS database_name
    ;
DropFuncStmt:
    DROP FUNCTION func_name func_args opt_drop_behavior
  | DROP FUNCTION IF_P EXISTS func_name func_args opt_drop_behavior
    ;
DropRoleStmt:
    DROP ROLE qualified_name_list
  | DROP ROLE IF_P EXISTS qualified_name_list
    ;
DropUserStmt:
    DROP USER qualified_name_list
  | DROP USER IF_P EXISTS qualified_name_list
    ;
DropGroupStmt:
    DROP GROUP_P qualified_name_list
  | DROP GROUP_P IF_P EXISTS qualified_name_list
    ;
DropStmt:
    DROP drop_type IF_P EXISTS any_name_list opt_drop_behavior
  | DROP drop_type any_name_list opt_drop_behavior
  | DROP INDEX CONCURRENTLY any_name_list opt_drop_behavior
  | DROP INDEX CONCURRENTLY IF_P EXISTS any_name_list opt_drop_behavior
    ;
drop_type:
    TABLE
  | EXTERNAL STREAM
  | EXTERNAL TABLE
  | SEQUENCE
  | VIEW
  | MATERIALIZED VIEW
  | INDEX
  | FOREIGN TABLE
  | EVENT TRIGGER
  | TYPE_P
  | DOMAIN_P
  | COLLATION
  | CONVERSION_P
  | SCHEMA
  | EXTENSION
    ;
opt_drop_behavior:
    CASCADE
  | RESTRICT
  | %empty
    ;
any_name_list:
    any_name
  | any_name_list COMMA any_name
    ;
any_name:
    ColId
  | ColId attrs
    ;
attrs:
    DOT attr_name
  | attrs DOT attr_name
    ;
DeclareCursorStmt:
    DECLARE cursor_name cursor_options CURSOR opt_hold FOR SelectStmt
    ;
cursor_options:
    %empty
  | cursor_options cursor_option
    ;
cursor_option:
    NO SCROLL
  | SCROLL
  | BINARY
  | INSENSITIVE
    ;
opt_hold:
    %empty
  | WITH HOLD
  | WITHOUT HOLD
    ;
FetchStmt:
    FETCH fetch_args opt_from_in cursor_name
  | FETCH cursor_name
  | MOVE fetch_args opt_from_in cursor_name
  | MOVE cursor_name
    ;
fetch_args:
    NEXT
  | PRIOR
  | FIRST_P
  | LAST_P
  | ABSOLUTE_P SignedIconst
  | RELATIVE_P SignedIconst
  | SignedIconst
  | ALL
  | FORWARD
  | FORWARD SignedIconst
  | FORWARD ALL
  | BACKWARD
  | BACKWARD SignedIconst
  | BACKWARD ALL
    ;
opt_from_in:
    FROM
  | IN_P
  | %empty
    ;
ClosePortalStmt:
    CLOSE cursor_name
  | CLOSE ALL
    ;
CloseExternalStreamStmt:
    CLOSE EXTERNAL STREAM qualified_name
  | CLOSE EXTERNAL STREAM IF_P EXISTS qualified_name
    ;
ViewStmt:
    CREATE OptTemp VIEW qualified_name opt_column_list opt_reloptions AS SelectStmt opt_check_option
  | CREATE OR REPLACE OptTemp VIEW qualified_name opt_column_list opt_reloptions AS SelectStmt opt_check_option
  | CREATE OptTemp RECURSIVE VIEW qualified_name LRB columnList RRB opt_reloptions AS SelectStmt opt_check_option
  | CREATE OR REPLACE OptTemp RECURSIVE VIEW qualified_name LRB columnList RRB opt_reloptions AS SelectStmt opt_check_option
    ;
opt_check_option:
    WITH CHECK OPTION
  | WITH CASCADED CHECK OPTION
  | WITH LOCAL CHECK OPTION
  | %empty
    ;
TruncateStmt:
    TRUNCATE opt_table relation_expr_list opt_restart_seqs opt_drop_behavior
    ;
opt_restart_seqs:
    CONTINUE_P IDENTITY_P
  | RESTART IDENTITY_P
  | %empty
    ;
opt_table:
    TABLE
  | %empty
    ;
AnalyzeStmt:
    analyze opt_verbose
  | analyze opt_verbose qualified_name opt_name_list
    ;
opt_verbose:
    VERBOSE
  | %empty
    ;
PrepareStmt:
    PREPARE name prep_type_clause AS PreparableStmt
    ;
prep_type_clause:
    LRB prep_type_list RRB
  | %empty
    ;
prep_type_list:
    prep_type_list_item
  | prep_type_list COMMA prep_type_list_item
    ;
prep_type_list_item:
    Typename
  | param_name Typename
    ;
PreparableStmt:
    SelectStmt
  | InsertStmt
  | UpdateStmt
  | DeleteStmt
  | MergeStmt
    ;
ExecuteStmt:
    EXECUTE name execute_param_clause
    ;
execute_param_clause:
    LRB execute_arg_list RRB
  | %empty
    ;
execute_arg_list:
    execute_arg_list_item
  | execute_arg_list COMMA execute_arg_list_item
    ;
execute_arg_list_item:
    a_expr
  | param_name COLON_EQUALS a_expr
  | param_name EQUALS_GREATER a_expr
    ;
CallStmt:
    CALL name LRB call_param_clause RRB
    ;
call_param_clause:
    func_arg_list
  | %empty
    ;
DeallocateStmt:
    DEALLOCATE name
  | DEALLOCATE PREPARE name
  | DEALLOCATE ALL
  | DEALLOCATE PREPARE ALL
    ;
ExplainStmt:
    EXPLAIN ExplainableStmt
  | EXPLAIN LRB explain_option_list RRB ExplainableStmt
    ;
FormatExpressionsStmt:
    EXPRESSIONS LRB expr_list RRB
    ;
ExplainableStmt:
    SelectStmt
  | InsertStmt
  | UpdateStmt
  | DeleteStmt
  | MergeStmt
  | TruncateStmt
  | CopyStmt
  | ExecuteStmt
  | FormatExpressionsStmt
    ;
explain_option_list:
    explain_option_elem
  | explain_option_list COMMA explain_option_elem
    ;
explain_option_elem:
    explain_option_name explain_option_arg
  | IDENT LRB columnList RRB
    ;
explain_option_name:
    NonReservedWord
  | analyze
  | FORMAT_LA
    ;
explain_option_arg:
    opt_boolean_or_string
  | NumericOnly
  | descriptor
  | %empty
    ;
analyze:
    ANALYZE
  | ANALYSE
    ;
opt_name_list:
    LRB name_list RRB
  | %empty
    ;
GrantStmt:
    GRANT privileges ON privilege_target TO grantee_list opt_grant_grant_option
    ;
RevokeStmt:
    REVOKE privileges ON privilege_target FROM grantee_list opt_drop_behavior
  | REVOKE GRANT OPTION FOR privileges ON privilege_target FROM grantee_list opt_drop_behavior
    ;
privileges:
    privilege_list
  | ALL
  | ALL PRIVILEGES
  | ALL LRB columnList RRB
  | ALL PRIVILEGES LRB columnList RRB
    ;
privilege_list:
    privilege
  | privilege_list COMMA privilege
    ;
privilege:
    SELECT opt_column_list
  | REFERENCES opt_column_list
  | CREATE opt_column_list
  | qualified_name opt_column_list
    ;
privilege_target:
    qualified_name_list
  | TABLE qualified_name_list
  | SEQUENCE qualified_name_list
  | FOREIGN DATA_P WRAPPER name_list
  | FOREIGN SERVER name_list
  | FUNCTION function_with_argtypes_list
  | DATABASE name_list
  | DOMAIN_P any_name_list
  | LANGUAGE name_list
  | LARGE_P OBJECT_P NumericOnly_list
  | SCHEMA qualified_name_list
  | TABLESPACE name_list
  | TYPE_P any_name_list
  | ALL TABLES IN_P SCHEMA qualified_name_list
  | ALL SEQUENCES IN_P SCHEMA qualified_name_list
  | ALL FUNCTIONS IN_P SCHEMA qualified_name_list
    ;
grantee_list:
    grantee
  | grantee_list COMMA grantee
    ;
grantee:
    qualified_name
  | GROUP_P qualified_name
    ;
opt_grant_grant_option:
    WITH GRANT OPTION
  | %empty
    ;
function_with_argtypes_list:
    function_with_argtypes
  | function_with_argtypes_list COMMA function_with_argtypes
    ;
GrantRoleStmt:
    GRANT privilege_list TO qualified_name_list opt_grant_admin_option opt_granted_by
    ;
RevokeRoleStmt:
    REVOKE privilege_list FROM qualified_name_list opt_granted_by opt_drop_behavior
  | REVOKE ADMIN OPTION FOR privilege_list FROM qualified_name_list opt_granted_by opt_drop_behavior
    ;
opt_grant_admin_option:
    WITH ADMIN OPTION
  | %empty
    ;
opt_granted_by:
    GRANTED BY qualified_name
  | %empty
    ;
InsertStmt:
    opt_with_clause INSERT opt_bulk INTO qualified_name insert_rest returning_clause
    ;
opt_bulk:
    BULK
  | %empty
    ;
insert_rest:
    SelectStmt
  | LRB insert_column_list RRB SelectStmt
  | DEFAULT VALUES
    ;
insert_column_list:
    insert_column_item
  | insert_column_list COMMA insert_column_item
    ;
insert_column_item:
    ColId
    ;
returning_clause:
    RETURNING target_list
  | %empty
    ;
RenameStmt:
    ALTER AGGREGATE func_name aggr_args RENAME TO name
  | ALTER COLLATION any_name RENAME TO name
  | ALTER CONVERSION_P any_name RENAME TO name
  | ALTER opt_db_locality DATABASE database_name RENAME TO database_name
  | ALTER DOMAIN_P any_name RENAME TO name
  | ALTER DOMAIN_P any_name RENAME CONSTRAINT name TO name
  | ALTER FOREIGN DATA_P WRAPPER name RENAME TO name
  | ALTER FUNCTION function_with_argtypes RENAME TO name
  | ALTER GROUP_P qualified_name RENAME TO RoleId
  | ALTER opt_procedural LANGUAGE name RENAME TO name
  | ALTER OPERATOR CLASS any_name USING access_method RENAME TO name
  | ALTER OPERATOR FAMILY any_name USING access_method RENAME TO name
  | ALTER POLICY name ON qualified_name RENAME TO name
  | ALTER POLICY IF_P EXISTS name ON qualified_name RENAME TO name
  | ALTER SCHEMA qualified_name RENAME TO name
  | ALTER SERVER name RENAME TO name
  | ALTER TABLE relation_expr RENAME TO name
  | ALTER TABLE IF_P EXISTS relation_expr RENAME TO name
  | ALTER SEQUENCE qualified_name RENAME TO name
  | ALTER SEQUENCE IF_P EXISTS qualified_name RENAME TO name
  | ALTER VIEW qualified_name RENAME TO name
  | ALTER VIEW IF_P EXISTS qualified_name RENAME TO name
  | ALTER MATERIALIZED VIEW qualified_name RENAME TO name
  | ALTER MATERIALIZED VIEW IF_P EXISTS qualified_name RENAME TO name
  | ALTER INDEX qualified_name RENAME TO name
  | ALTER INDEX IF_P EXISTS qualified_name RENAME TO name
  | ALTER FOREIGN TABLE relation_expr RENAME TO name
  | ALTER FOREIGN TABLE IF_P EXISTS relation_expr RENAME TO name
  | ALTER TABLE relation_expr RENAME opt_column name TO name
  | ALTER TABLE IF_P EXISTS relation_expr RENAME opt_column name TO name
  | ALTER MATERIALIZED VIEW qualified_name RENAME opt_column name TO name
  | ALTER MATERIALIZED VIEW IF_P EXISTS qualified_name RENAME opt_column name TO name
  | ALTER TABLE relation_expr RENAME CONSTRAINT name TO name
  | ALTER FOREIGN TABLE relation_expr RENAME opt_column name TO name
  | ALTER FOREIGN TABLE IF_P EXISTS relation_expr RENAME opt_column name TO name
  | ALTER RULE name ON qualified_name RENAME TO name
  | ALTER TRIGGER name ON qualified_name RENAME TO name
  | ALTER EVENT TRIGGER name RENAME TO name
  | ALTER ROLE qualified_name RENAME TO RoleId
  | ALTER USER qualified_name RENAME TO RoleId
  | ALTER TABLESPACE name RENAME TO name
  | ALTER TEXT_P SEARCH PARSER any_name RENAME TO name
  | ALTER TEXT_P SEARCH DICTIONARY any_name RENAME TO name
  | ALTER TEXT_P SEARCH TEMPLATE any_name RENAME TO name
  | ALTER TEXT_P SEARCH CONFIGURATION any_name RENAME TO name
  | ALTER TYPE_P any_name RENAME TO name
  | ALTER TYPE_P any_name RENAME ATTRIBUTE name TO name opt_drop_behavior
    ;
opt_column:
    COLUMN
  | %empty
    ;
opt_procedural:
    PROCEDURAL
  | %empty
    ;
SelectStmt:
    select_no_parens %prec UMINUS
  | select_with_parens %prec UMINUS
    ;
select_with_parens:
    LRB select_no_parens RRB
  | LRB select_with_parens RRB
    ;
select_no_parens:
    simple_select
  | select_clause sort_clause
  | select_clause opt_sort_clause for_locking_clause opt_select_limit
  | select_clause opt_sort_clause select_limit opt_for_locking_clause
  | with_clause select_clause
  | with_clause select_clause sort_clause
  | with_clause select_clause opt_sort_clause for_locking_clause opt_select_limit
  | with_clause select_clause opt_sort_clause select_limit opt_for_locking_clause
    ;
select_clause:
    simple_select
  | select_with_parens
    ;
simple_select:
    SELECT opt_with_aggregation_threshold opt_all_clause opt_target_list into_clause from_clause where_clause group_clause having_clause window_clause
  | SELECT opt_with_aggregation_threshold distinct_clause target_list into_clause from_clause where_clause group_clause having_clause window_clause
  | values_clause
  | TABLE relation_expr
  | select_clause UNION opt_all select_clause
  | select_clause INTERSECT opt_all select_clause
  | select_clause EXCEPT opt_all select_clause
    ;
opt_with_aggregation_threshold:
    WITH_LA AGGREGATION_THRESHOLD
  | %empty
    ;
with_clause:
    WITH common_elements_list
  | WITH_LA common_elements_list
  | WITH RECURSIVE common_elements_list
    ;
into_clause:
    INTO OptTempTableName
  | %empty
    ;
OptTempTableName:
    TEMPORARY opt_table qualified_name
  | TEMP opt_table qualified_name
  | LOCAL TEMPORARY opt_table qualified_name
  | LOCAL TEMP opt_table qualified_name
  | GLOBAL TEMPORARY opt_table qualified_name
  | GLOBAL TEMP opt_table qualified_name
  | UNLOGGED opt_table qualified_name
  | TABLE qualified_name
  | qualified_name
    ;
common_elements_list:
    common_element_expr
  | common_elements_list COMMA common_element_expr
    ;
common_element_expr:
    name AS LRB SelectStmt RRB create_generic_options
  | name AS SECURE LRB SelectStmt RRB create_generic_options
  | name LRB name_list RRB AS LRB SelectStmt RRB create_generic_options
  | name LRB name_list RRB AS SECURE LRB SelectStmt RRB create_generic_options
  | name AS PROPERTY GRAPH LRB property_graph_definition RRB
    ;
property_graph_definition:
    opt_vertex_tables_clause opt_edge_tables_clause
    ;
opt_vertex_tables_clause:
    vertex_tables_clause
  | %empty
    ;
vertex_tables_clause:
    vertex_synonym TABLES LRB vertex_table_list RRB
    ;
vertex_synonym:
    NODE
  | VERTEX
    ;
vertex_table_list:
    vertex_table_definition
  | vertex_table_list COMMA vertex_table_definition
    ;
vertex_table_definition:
    qualified_name opt_propgraph_table_alias opt_graph_table_key_clause opt_element_table_label_and_properties
  | select_with_parens AS name opt_graph_table_key_clause opt_element_table_label_and_properties
    ;
opt_graph_table_key_clause:
    KEY LRB columnList RRB
  | %empty
    ;
opt_propgraph_table_alias:
    AS name
  | %empty
    ;
opt_edge_tables_clause:
    edge_tables_clause
  | %empty
    ;
edge_tables_clause:
    edge_synonym TABLES LRB edge_table_list RRB
    ;
edge_synonym:
    EDGE
  | RELATIONSHIP
    ;
edge_table_list:
    edge_table_definition
  | edge_table_list COMMA edge_table_definition
    ;
edge_table_definition:
    qualified_name opt_propgraph_table_alias opt_graph_table_key_clause source_vertex_table destination_vertex_table opt_element_table_label_and_properties
  | select_with_parens AS name opt_graph_table_key_clause source_vertex_table destination_vertex_table opt_element_table_label_and_properties
    ;
source_vertex_table:
    SOURCE name
  | SOURCE KEY LRB columnList RRB REFERENCES name opt_column_list
    ;
destination_vertex_table:
    DESTINATION name
  | DESTINATION KEY LRB columnList RRB REFERENCES name opt_column_list
    ;
opt_element_table_label_and_properties:
    element_table_properties
  | label_and_properties_list
  | %empty
    ;
label_and_properties_list:
    label_and_properties
  | label_and_properties_list label_and_properties
    ;
label_and_properties:
    element_table_label_clause
  | element_table_label_clause element_table_properties
    ;
element_table_label_clause:
    LABEL name
  | DEFAULT LABEL
    ;
element_table_properties:
    NO PROPERTIES
  | PROPERTIES opt_are ALL COLUMNS opt_except_clause
  | PROPERTIES LRB property_list RRB
    ;
opt_are:
    ARE
  | %empty
    ;
opt_except_clause:
    EXCEPT LRB columnList RRB
  | %empty
    ;
property_list:
    property
  | property_list COMMA property
    ;
property:
    name
  | a_expr AS ColId
    ;
distinct_clause:
    DISTINCT
  | DISTINCT ON LRB expr_list RRB
    ;
opt_with_clause:
    with_clause
  | %empty
    ;
opt_all:
    ALL
  | DISTINCT
  | %empty
    ;
opt_all_clause:
    ALL
  | %empty
    ;
opt_sort_clause:
    sort_clause
  | %empty
    ;
sort_clause:
    ORDER BY sortby_list
    ;
sortby_list:
    sortby
  | sortby_list COMMA sortby
    ;
sortby:
    a_expr opt_asc_desc opt_nulls_order
  | ALL opt_asc_desc opt_nulls_order
    ;
select_limit:
    limit_clause offset_clause
  | offset_clause limit_clause
  | limit_clause
  | offset_clause
    ;
opt_select_limit:
    select_limit
  | %empty
    ;
limit_clause:
    LIMIT select_limit_value
  | FETCH first_or_next opt_select_fetch_first_value row_or_rows ONLY
  | FETCH first_or_next opt_select_fetch_first_value row_or_rows WITH TIES
    ;
offset_clause:
    OFFSET select_offset_value
  | OFFSET select_offset_value2 row_or_rows
    ;
select_limit_value:
    a_expr
  | ALL
    ;
select_offset_value:
    a_expr
    ;
opt_select_fetch_first_value:
    SignedIconst
  | LRB a_expr RRB
  | %empty
    ;
select_offset_value2:
    c_expr
    ;
row_or_rows:
    ROW
  | ROWS
    ;
first_or_next:
    FIRST_P
  | NEXT
    ;
group_clause:
    GROUP_P BY opt_gb_distinct group_by_list
  | GROUP_P BY ALL
  | %empty
    ;
opt_gb_distinct:
    ALL
  | DISTINCT
  | %empty
    ;
group_by_list:
    group_by_item
  | group_by_list COMMA group_by_item
    ;
group_by_item:
    a_expr
  | empty_grouping_set
  | cube_clause
  | rollup_clause
  | grouping_sets_clause
    ;
empty_grouping_set:
    LRB RRB
    ;
cube_clause:
    CUBE LRB expr_list RRB
    ;
rollup_clause:
    ROLLUP LRB expr_list RRB
    ;
grouping_sets_clause:
    GROUPING SETS LRB group_by_list RRB
    ;
having_clause:
    HAVING a_expr
  | %empty
    ;
for_locking_clause:
    for_locking_items
  | FOR READ ONLY
    ;
opt_for_locking_clause:
    for_locking_clause
  | %empty
    ;
for_locking_items:
    for_locking_item
  | for_locking_items for_locking_item
    ;
for_locking_item:
    for_locking_strength locked_rels_list opt_nowait
    ;
for_locking_strength:
    FOR UPDATE
  | FOR NO KEY UPDATE
  | FOR SHARE
  | FOR KEY SHARE
    ;
locked_rels_list:
    OF qualified_name_list
  | %empty
    ;
opt_nowait:
    NOWAIT
  | %empty
    ;
values_clause:
    VALUES values_row_list
    ;
values_row_list:
    ctext_row
  | values_row_list COMMA ctext_row
    ;
from_clause:
    FROM from_list
  | %empty
    ;
from_list:
    table_ref
  | from_list COMMA table_ref
    ;
table_ref:
    relation_expr opt_ordinality opt_table_ref_options opt_alias_clause
  | relation_expr opt_ordinality opt_table_ref_options opt_alias_clause tablesample_clause
  | stream_expr opt_alias_clause
  | func_table opt_ordinality opt_table_ref_options func_alias_clause
  | TABLE LRB func_table RRB opt_ordinality opt_table_ref_options func_alias_clause
  | LATERAL_P func_table opt_ordinality opt_table_ref_options func_alias_clause
  | GRAPH_TABLE LRB qualified_name MATCH graph_pattern opt_graph_table_rows_clause opt_columns_clause RRB opt_alias_clause
  | select_with_parens opt_ordinality opt_table_ref_options opt_alias_clause
  | LATERAL_P select_with_parens opt_ordinality opt_table_ref_options opt_alias_clause
  | joined_table
  | LRB joined_table RRB alias_clause
    ;
opt_ordinality:
    WITH_LA ORDINALITY opt_ordinality_name
  | %empty
    ;
opt_table_ref_options:
    WITH_OPTIONS_LA OPTIONS LRB hyper_copy_opt_list RRB
  | %empty
    ;
opt_ordinality_name:
    LRB ColId RRB
  | %empty
    ;
stream_expr:
    EXTERNAL STREAM qualified_name opt_with_cardinality_hint
    ;
opt_with_cardinality_hint:
    LRB WITH LRB CARDINALITY cardinality_hint RRB RRB
  | %empty
    ;
cardinality_hint:
    NumericOnly
    ;
graph_pattern:
    path_pattern_list where_clause
    ;
path_pattern_list:
    path_pattern
  | path_pattern_list COMMA path_pattern
    ;
path_pattern:
    path_pattern_expression
    ;
path_pattern_expression:
    path_term
    ;
path_term:
    path_factor
  | path_term path_factor
    ;
path_factor:
    path_primary
    ;
path_primary:
    LRB opt_colid opt_is_label_expression where_clause RRB
  | LESS_THAN MINUS LSB opt_colid opt_is_label_expression where_clause RSB MINUS opt_graph_pattern_quantifier opt_questioned
  | MINUS LSB opt_colid opt_is_label_expression where_clause RSB Op opt_graph_pattern_quantifier opt_questioned
  | MINUS LSB opt_colid opt_is_label_expression where_clause RSB MINUS opt_graph_pattern_quantifier opt_questioned
    ;
opt_graph_pattern_quantifier:
    fixed_quantifier
  | general_quantifier
  | %empty
    ;
opt_questioned:
    QUESTION_MARK
  | %empty
    ;
fixed_quantifier:
    LCB Iconst RCB
    ;
general_quantifier:
    LCB Iconst COMMA Iconst RCB
  | LCB COMMA Iconst RCB
  | LCB Iconst COMMA RCB
  | LCB COMMA RCB
    ;
opt_colid:
    ColId
  | %empty
    ;
opt_is_label_expression:
    IS label_expression
  | COLON label_expression
  | %empty
    ;
label_expression:
    label_term
  | label_expression PIPE label_term
    ;
label_term:
    label_factor
  | label_term AMPERSAND label_factor
    ;
label_factor:
    label_primary
  | EXCLAMATION_MARK label_primary
    ;
label_primary:
    name
  | MODULO
  | LRB label_expression RRB
    ;
opt_graph_table_rows_clause:
    ONE ROW PER MATCH
  | ONE ROW PER STEP LRB ColId COMMA ColId COMMA ColId RRB
  | %empty
    ;
opt_columns_clause:
    COLUMNS LRB graph_columns_list RRB
  | %empty
    ;
graph_columns_list:
    graph_column
  | graph_columns_list COMMA graph_column
    ;
graph_column:
    a_expr AS ColLabel
  | a_expr
  | columnref DOT_LA STAR opt_star_exclude
    ;
columnDef_list:
    columnDef
  | columnDef_list COMMA columnDef
    ;
joined_table:
    LRB joined_table RRB
  | table_ref CROSS JOIN table_ref
  | table_ref join_type JOIN table_ref join_qual
  | table_ref JOIN table_ref join_qual
  | table_ref NATURAL join_type JOIN table_ref
  | table_ref NATURAL JOIN table_ref
    ;
alias_clause:
    AS ColId LRB name_list RRB
  | AS ColId
  | ColId LRB name_list RRB
  | ColId
    ;
opt_alias_clause:
    alias_clause
  | %empty
    ;
func_alias_clause:
    alias_clause
  | AS LRB TableFuncElementList RRB
  | AS ColId LRB TableFuncElementList RRB
  | ColId LRB TableFuncElementList RRB
  | %empty
    ;
join_type:
    FULL join_outer
  | LEFT join_outer
  | RIGHT join_outer
  | INNER_P
    ;
join_outer:
    OUTER_P
  | %empty
    ;
join_qual:
    USING LRB name_list RRB
  | ON a_expr
    ;
relation_expr:
    qualified_name
  | qualified_name STAR
  | ONLY qualified_name
  | ONLY LRB qualified_name RRB
    ;
relation_expr_list:
    relation_expr
  | relation_expr_list COMMA relation_expr
    ;
relation_expr_opt_alias:
    relation_expr %prec UMINUS
  | relation_expr ColId
  | relation_expr AS ColId
    ;
tablesample_clause:
    TABLESAMPLE func_name LRB sample_size RRB opt_repeatable_clause
    ;
sample_size:
    AexprConst
  | AexprConst PERCENT opt_limit_clause
  | AexprConst ROWS
    ;
opt_repeatable_clause:
    REPEATABLE LRB AexprConst RRB
  | %empty
    ;
opt_limit_clause:
    BETWEEN AexprConst ROWS AND AexprConst ROWS
  | BETWEEN UNBOUNDED ROWS AND AexprConst ROWS
  | BETWEEN AexprConst ROWS AND UNBOUNDED ROWS
  | %empty
    ;
func_table:
    func_expr_windowless
  | semantic_view_application
  | ROWS FROM LRB rowsfrom_list RRB
    ;
rowsfrom_item:
    func_expr_windowless opt_col_def_list
    ;
rowsfrom_list:
    rowsfrom_item
  | rowsfrom_list COMMA rowsfrom_item
    ;
opt_col_def_list:
    AS LRB TableFuncElementList RRB
  | %empty
    ;
where_clause:
    WHERE a_expr
  | %empty
    ;
where_or_current_clause:
    WHERE a_expr
  | WHERE CURRENT_P OF cursor_name
  | %empty
    ;
OptTableFuncElementList:
    TableFuncElementList
  | %empty
    ;
TableFuncElementList:
    TableFuncElement
  | TableFuncElementList COMMA TableFuncElement
    ;
TableFuncElement:
    ColId Typename opt_collate_clause opt_not_null
    ;
opt_collate_clause:
    COLLATE any_name
  | %empty
    ;
cursor_name:
    name
    ;
opt_not_null:
    NOT NULL_P
  | %empty
    ;
TransactionStmt:
    ABORT_P opt_transaction
  | BEGIN_P opt_transaction transaction_mode_list_or_empty
  | START TRANSACTION transaction_mode_list_or_empty
  | COMMIT opt_transaction
  | END_P opt_transaction
  | ROLLBACK opt_transaction
  | SAVEPOINT ColId
  | RELEASE SAVEPOINT ColId
  | RELEASE ColId
  | ROLLBACK opt_transaction TO SAVEPOINT ColId
  | ROLLBACK opt_transaction TO ColId
  | PREPARE TRANSACTION Sconst
  | COMMIT PREPARED Sconst
  | ROLLBACK PREPARED Sconst
    ;
opt_transaction:
    WORK
  | TRANSACTION
  | %empty
    ;
transaction_mode_item:
    ISOLATION LEVEL iso_level
  | READ ONLY
  | READ WRITE
  | DEFERRABLE
  | NOT DEFERRABLE
    ;
iso_level:
    READ UNCOMMITTED
  | READ COMMITTED
  | REPEATABLE READ
  | SERIALIZABLE
    ;
transaction_mode_list:
    transaction_mode_item
  | transaction_mode_list COMMA transaction_mode_item
  | transaction_mode_list transaction_mode_item
    ;
transaction_mode_list_or_empty:
    transaction_mode_list
  | %empty
    ;
UpdateStmt:
    opt_with_clause UPDATE relation_expr_opt_alias SET set_clause_list where_or_current_clause returning_clause
  | opt_with_clause UPDATE relation_expr_opt_alias SET set_clause_list FROM from_list where_or_current_clause returning_clause
    ;
set_clause_list:
    set_clause
  | set_clause_list COMMA set_clause
    ;
set_clause:
    single_set_clause
  | multiple_set_clause
    ;
single_set_clause:
    set_target EQUALS ctext_expr
    ;
multiple_set_clause:
    LRB set_target_list RRB EQUALS ctext_row
  | LRB set_target_list RRB EQUALS ROW ctext_row
  | LRB set_target_list RRB EQUALS select_with_parens
    ;
set_target:
    ColId
    ;
set_target_list:
    set_target
  | set_target_list COMMA set_target
    ;
MergeStmt:
    opt_with_clause MERGE INTO relation_expr_opt_alias USING table_ref ON a_expr merge_when_list returning_clause
    ;
merge_when_list:
    merge_when_clause
  | merge_when_list merge_when_clause
    ;
merge_when_clause:
    WHEN MATCHED opt_merge_condition THEN merge_matched_action
  | WHEN NOT MATCHED BY SOURCE opt_merge_condition THEN merge_matched_action
  | WHEN NOT MATCHED opt_merge_condition THEN merge_not_matched_action
  | WHEN NOT MATCHED BY TARGET opt_merge_condition THEN merge_not_matched_action
    ;
opt_merge_condition:
    AND a_expr
  | %empty
    ;
merge_matched_action:
    merge_update
  | merge_delete
  | merge_do_nothing
    ;
merge_not_matched_action:
    merge_insert
  | merge_do_nothing
    ;
merge_update:
    UPDATE SET set_clause_list
    ;
merge_delete:
    DELETE_P
    ;
merge_insert:
    INSERT VALUES ctext_row
  | INSERT LRB insert_column_list RRB VALUES ctext_row
    ;
merge_do_nothing:
    DO NOTHING
    ;
ValidateStmt:
    VALIDATE opt_db_locality DATABASE database_name opt_attach_database_options
    ;
VariableSetStmt:
    SET set_rest
  | SET LOCAL set_rest
  | SET SESSION set_rest
    ;
set_rest:
    TRANSACTION transaction_mode_list
  | SESSION CHARACTERISTICS AS TRANSACTION transaction_mode_list
  | set_rest_more
    ;
generic_set:
    var_name TO var_list
  | var_name EQUALS var_list
  | var_name TO DEFAULT
  | var_name EQUALS DEFAULT
    ;
set_rest_more:
    generic_set
  | var_name FROM CURRENT_P
  | TIME ZONE zone_value
  | CATALOG_P Sconst
  | SCHEMA Sconst
  | NAMES opt_encoding
  | ROLE NonReservedWord_or_Sconst
  | SESSION AUTHORIZATION NonReservedWord_or_Sconst
  | SESSION AUTHORIZATION DEFAULT
  | TRANSACTION SNAPSHOT Sconst
    ;
var_name:
    ColId
  | var_name DOT ColId
    ;
var_list:
    var_value
  | var_list COMMA var_value
    ;
var_value:
    opt_boolean_or_string
  | NumericOnly
    ;
zone_value:
    Sconst
  | IDENT
  | ConstInterval Sconst opt_interval
  | ConstInterval LRB Iconst RRB Sconst
  | NumericOnly
  | DEFAULT
  | LOCAL
    ;
opt_encoding:
    Sconst
  | DEFAULT
  | %empty
    ;
VariableResetStmt:
    RESET reset_rest
    ;
reset_rest:
    generic_reset
  | TIME ZONE
  | TRANSACTION ISOLATION LEVEL
  | SESSION AUTHORIZATION
    ;
generic_reset:
    var_name
  | ALL
  | ALL GLOBAL
    ;
SetResetClause:
    SET set_rest
  | VariableResetStmt
    ;
FunctionSetResetClause:
    SET set_rest_more
  | VariableResetStmt
    ;
VariableShowStmt:
    SHOW var_name
  | SHOW TIME ZONE
  | SHOW TRANSACTION ISOLATION LEVEL
  | SHOW SESSION AUTHORIZATION
  | SHOW ALL
    ;
Typename:
    SimpleTypename opt_array_bounds
  | SETOF SimpleTypename opt_array_bounds
  | SimpleTypename ARRAY LSB Iconst RSB
  | SETOF SimpleTypename ARRAY LSB Iconst RSB
  | SimpleTypename ARRAY
  | SETOF SimpleTypename ARRAY
  | ARRAY_LA LRB Typename NOT NULL_P RRB
  | ARRAY_LA LRB Typename RRB
  | ROW LRB OptTableFuncElementList RRB
    ;
opt_array_bounds:
    opt_array_bounds LSB RSB
  | opt_array_bounds LSB Iconst RSB
  | %empty
    ;
SimpleTypename:
    GenericType
  | Numeric
  | Bit
  | Character
  | ConstDatetime
  | ConstInterval opt_interval
  | ConstInterval LRB Iconst RRB
  | JsonType
    ;
ConstTypename:
    Numeric
  | ConstBit
  | ConstCharacter
  | ConstDatetime
  | JsonType
    ;
GenericType:
    type_function_name opt_type_modifiers
  | type_function_name attrs opt_type_modifiers
    ;
opt_type_modifiers:
    LRB expr_list RRB
  | %empty
    ;
Numeric:
    INT_P
  | INTEGER
  | SMALLINT
  | BIGINT
  | REAL
  | FLOAT_P opt_float
  | DOUBLE_P PRECISION
  | DECIMAL_P opt_type_modifiers
  | DEC opt_type_modifiers
  | NUMERIC opt_type_modifiers
  | BOOLEAN_P
    ;
opt_float:
    LRB Iconst RRB
  | %empty
    ;
Bit:
    BitWithLength
  | BitWithoutLength
    ;
ConstBit:
    BitWithLength
  | BitWithoutLength
    ;
BitWithLength:
    BIT opt_varying LRB expr_list RRB
    ;
BitWithoutLength:
    BIT opt_varying
    ;
Character:
    CharacterWithLength
  | CharacterWithoutLength
    ;
ConstCharacter:
    CharacterWithLength
  | CharacterWithoutLength
    ;
CharacterWithLength:
    character LRB Iconst RRB opt_charset
    ;
CharacterWithoutLength:
    character opt_charset
    ;
character:
    CHARACTER opt_varying
  | CHAR_P opt_varying
  | VARCHAR
  | NATIONAL CHARACTER opt_varying
  | NATIONAL CHAR_P opt_varying
  | NCHAR opt_varying
    ;
opt_varying:
    VARYING
  | %empty
    ;
opt_charset:
    CHARACTER SET ColId
  | %empty
    ;
ConstDatetime:
    TIMESTAMP opt_timezone
  | TIME opt_timezone
    ;
ConstInterval:
    INTERVAL
    ;
opt_timezone:
    WITH_LA TIME ZONE
  | WITHOUT_LA TIME ZONE
  | %empty
    ;
opt_interval:
    YEAR_P
  | MONTH_P
  | DAY_P
  | HOUR_P
  | MINUTE_P
  | interval_second
  | YEAR_P TO MONTH_P
  | DAY_P TO HOUR_P
  | DAY_P TO MINUTE_P
  | DAY_P TO interval_second
  | HOUR_P TO MINUTE_P
  | HOUR_P TO interval_second
  | MINUTE_P TO interval_second
  | %empty
    ;
interval_second:
    SECOND_P
  | SECOND_P LRB Iconst RRB
    ;
JsonType:
    JSON
    ;
descriptor:
    DESCRIPTOR LRB descriptor_arg_list RRB
  | DESCRIPTOR LRB RRB
    ;
descriptor_arg_list:
    descriptor_arg
  | descriptor_arg_list COMMA descriptor_arg
    ;
descriptor_arg:
    NonReservedWord
  | NonReservedWord Typename ColQualList
    ;
a_expr:
    c_expr
  | a_expr TYPECAST Typename
  | a_expr COLLATE any_name
  | a_expr AT TIME ZONE a_expr %prec AT
  | PLUS a_expr %prec UMINUS
  | MINUS a_expr %prec UMINUS
  | a_expr PLUS a_expr
  | a_expr MINUS a_expr
  | a_expr STAR a_expr
  | a_expr DIVIDE a_expr
  | a_expr MODULO a_expr
  | a_expr CIRCUMFLEX a_expr
  | a_expr LESS_THAN a_expr
  | a_expr GREATER_THAN a_expr
  | a_expr EQUALS a_expr
  | a_expr LESS_EQUALS a_expr
  | a_expr GREATER_EQUALS a_expr
  | a_expr NOT_EQUALS a_expr
  | a_expr qual_Op a_expr %prec Op
  | qual_Op a_expr %prec Op
  | a_expr AND a_expr
  | a_expr OR a_expr
  | NOT a_expr
  | NOT_LA a_expr %prec NOT
  | a_expr LIKE a_expr
  | a_expr LIKE a_expr ESCAPE a_expr %prec LIKE
  | a_expr NOT_LA LIKE a_expr %prec NOT_LA
  | a_expr NOT_LA LIKE a_expr ESCAPE a_expr %prec NOT_LA
  | a_expr ILIKE a_expr
  | a_expr ILIKE a_expr ESCAPE a_expr %prec ILIKE
  | a_expr NOT_LA ILIKE a_expr %prec NOT_LA
  | a_expr NOT_LA ILIKE a_expr ESCAPE a_expr%prec NOT_LA
  | a_expr SIMILAR TO a_expr %prec SIMILAR
  | a_expr SIMILAR TO a_expr ESCAPE a_expr %prec SIMILAR
  | a_expr NOT_LA SIMILAR TO a_expr %prec NOT_LA
  | a_expr NOT_LA SIMILAR TO a_expr ESCAPE a_expr %prec NOT_LA
  | a_expr IS NULL_P %prec IS
  | a_expr ISNULL
  | a_expr IS NOT NULL_P %prec IS
  | a_expr NOTNULL
  | a_expr IS TRUE_P %prec IS
  | a_expr IS NOT TRUE_P %prec IS
  | a_expr IS FALSE_P %prec IS
  | a_expr IS NOT FALSE_P %prec IS
  | a_expr IS UNKNOWN %prec IS
  | a_expr IS NOT UNKNOWN %prec IS
  | a_expr IS DISTINCT FROM a_expr %prec IS
  | a_expr IS NOT DISTINCT FROM a_expr %prec IS
  | a_expr IS OF LRB type_list RRB %prec IS
  | a_expr IS NOT OF LRB type_list RRB %prec IS
  | a_expr BETWEEN opt_asymmetric b_expr AND a_expr %prec BETWEEN
  | a_expr NOT_LA BETWEEN opt_asymmetric b_expr AND a_expr %prec NOT_LA
  | a_expr BETWEEN SYMMETRIC b_expr AND a_expr %prec BETWEEN
  | a_expr NOT_LA BETWEEN SYMMETRIC b_expr AND a_expr %prec NOT_LA
  | a_expr IN_P in_expr
  | a_expr NOT_LA IN_P in_expr %prec NOT_LA
  | a_expr subquery_Op sub_type select_with_parens %prec Op
  | a_expr subquery_Op sub_type LRB a_expr RRB %prec Op
  | UNIQUE select_with_parens
    ;
b_expr:
    c_expr
  | b_expr TYPECAST Typename
  | PLUS b_expr %prec UMINUS
  | MINUS b_expr %prec UMINUS
  | b_expr PLUS b_expr
  | b_expr MINUS b_expr
  | b_expr STAR b_expr
  | b_expr DIVIDE b_expr
  | b_expr MODULO b_expr
  | b_expr CIRCUMFLEX b_expr
  | b_expr LESS_THAN b_expr
  | b_expr GREATER_THAN b_expr
  | b_expr EQUALS b_expr
  | b_expr LESS_EQUALS b_expr
  | b_expr GREATER_EQUALS b_expr
  | b_expr NOT_EQUALS b_expr
  | b_expr qual_Op b_expr %prec Op
  | qual_Op b_expr %prec Op
  | b_expr IS DISTINCT FROM b_expr %prec IS
  | b_expr IS NOT DISTINCT FROM b_expr %prec IS
  | b_expr IS OF LRB type_list RRB %prec IS
  | b_expr IS NOT OF LRB type_list RRB %prec IS
    ;
c_expr:
    columnref
  | AexprConst
  | PARAM opt_indirection
  | COLON IDENT opt_indirection
  | qmark_parameter opt_indirection
  | LRB a_expr RRB opt_indirection
  | case_expr
  | func_expr
  | select_with_parens %prec UMINUS
  | select_with_parens indirection
  | EXISTS select_with_parens
  | ARRAY_LA select_with_parens
  | ARRAY array_expr
  | explicit_row
  | implicit_row
  | GROUPING LRB expr_list RRB
    ;
qmark_parameter:
    QUESTION_MARK
    ;
semantic_view_target_list:
    semantic_view_target_list_el
  | semantic_view_target_list COMMA semantic_view_target_list_el
    ;
semantic_view_target_list_el:
    a_expr AS ColLabel
  | a_expr
    ;
semantic_view_application:
    func_name LRB Sconst semantic_view_clause_list RRB
  | func_name LRB ColId semantic_view_clause_list RRB
    ;
semantic_view_clause_list:
    semantic_view_clause
  | semantic_view_clause_list semantic_view_clause
    ;
semantic_view_clause:
    DIMENSIONS semantic_view_target_list
  | MEASURES semantic_view_target_list
  | FACTS semantic_view_target_list
  | WHERE a_expr
    ;
func_application:
    func_name LRB opt_sort_clause RRB
  | func_name LRB func_arg_list opt_sort_clause opt_null_or_absent_on_null RRB
  | func_name LRB VARIADIC func_arg_list_item opt_sort_clause RRB
  | func_name LRB func_arg_list COMMA VARIADIC func_arg_list_item opt_sort_clause RRB
  | func_name LRB ALL func_arg_list opt_sort_clause opt_null_or_absent_on_null RRB
  | func_name LRB DISTINCT func_arg_list opt_sort_clause opt_null_or_absent_on_null RRB
  | func_name LRB STAR RRB
    ;
opt_null_or_absent_on_null:
    NULL_P ON NULL_P
  | ABSENT ON NULL_P
  | %empty
    ;
nth_value_name:
    NTH_VALUE
    ;
func_builtin_window:
    nth_value_name LRB func_arg_list RRB opt_from_last
    ;
opt_from_last:
    FROM FIRST_P
  | FROM LAST_P
  | %empty
    ;
respect_or_ignore_nulls:
    RESPECT NULLS_P
  | IGNORE NULLS_P
  | %empty
    ;
func_expr:
    func_application respect_or_ignore_nulls within_group_clause filter_clause opt_over_clause
  | func_builtin_window respect_or_ignore_nulls over_clause
  | func_expr_common_subexpr
    ;
func_expr_windowless:
    func_application
  | func_expr_common_subexpr
    ;
func_expr_common_subexpr:
    COLLATION FOR LRB a_expr RRB
  | CURRENT_DATE
  | CURRENT_DATE LRB RRB
  | CURRENT_TIME
  | CURRENT_TIME LRB Iconst RRB
  | CURRENT_TIMESTAMP
  | CURRENT_TIMESTAMP LRB Iconst RRB
  | LOCALTIME
  | LOCALTIME LRB Iconst RRB
  | LOCALTIMESTAMP
  | LOCALTIMESTAMP LRB Iconst RRB
  | CURRENT_ROLE
  | CURRENT_USER
  | SESSION_USER
  | USER
  | CURRENT_CATALOG
  | CURRENT_SCHEMA
  | CAST LRB a_expr AS Typename RRB
  | CAST LRB a_expr AS Typename OR NULL_P RRB
  | TRY_CAST LRB a_expr AS Typename RRB
  | EXTRACT LRB extract_list RRB
  | OVERLAY LRB overlay_list RRB
  | POSITION LRB position_list RRB
  | SUBSTRING LRB substr_list RRB
  | TREAT LRB a_expr AS Typename RRB
  | TRIM LRB BOTH trim_list RRB
  | TRIM LRB LEADING trim_list RRB
  | TRIM LRB TRAILING trim_list RRB
  | TRIM LRB trim_list RRB
  | NULLIF LRB a_expr COMMA a_expr RRB
  | COALESCE LRB expr_list RRB
  | GREATEST LRB expr_list RRB
  | LEAST LRB expr_list RRB
  | GREATEST LRB PRESERVE NULLS_P expr_list RRB
  | LEAST LRB PRESERVE NULLS_P expr_list RRB
  | JSON LRB json_value_expr json_key_uniqueness_constraint_opt RRB
  | JSON_SCALAR LRB a_expr RRB
  | JSON_OBJECT LRB json_name_and_value_list json_object_constructor_null_clause_opt json_key_uniqueness_constraint_opt RRB
  | JSON_OBJECT LRB RRB
  | JSON_ARRAY LRB json_value_expr_list json_array_constructor_null_clause_opt RRB
  | JSON_ARRAY LRB RRB
  | JSON_QUERY LRB json_value_expr COMMA a_expr json_passing_clause_opt json_returning_clause_opt json_wrapper_behavior json_quotes_clause_opt json_behavior_clause_opt RRB
  | JSON_VALUE LRB json_value_expr COMMA a_expr json_passing_clause_opt json_returning_clause_opt json_behavior_clause_opt RRB
  | JSON_EXISTS LRB json_value_expr COMMA a_expr json_passing_clause_opt json_on_error_clause_opt RRB
    ;
window_clause:
    WINDOW window_definition_list
  | %empty
    ;
window_definition_list:
    window_definition
  | window_definition_list COMMA window_definition
    ;
window_definition:
    ColId AS window_specification
    ;
within_group_clause:
    WITHIN GROUP_P LRB sort_clause RRB
  | %empty
    ;
filter_clause:
    FILTER LRB WHERE a_expr RRB
  | %empty
    ;
over_clause:
    OVER window_specification
  | OVER ColId
    ;
opt_over_clause:
    over_clause
  | %empty
    ;
window_specification:
    LRB opt_existing_window_name opt_partition_clause opt_sort_clause opt_frame_clause RRB
    ;
opt_partition_clause:
    PARTITION BY expr_list
  | %empty
    ;
opt_existing_window_name:
    ColId
  | %empty %prec Op
    ;
opt_frame_clause:
    RANGE frame_extent opt_window_exclusion_clause
  | ROWS frame_extent opt_window_exclusion_clause
  | GROUPS frame_extent opt_window_exclusion_clause
  | %empty
    ;
frame_extent:
    frame_bound
  | BETWEEN frame_bound AND frame_bound
    ;
frame_bound:
    UNBOUNDED PRECEDING
  | UNBOUNDED FOLLOWING
  | CURRENT_P ROW
  | a_expr PRECEDING
  | a_expr FOLLOWING
  | a_expr PRECEDING OR NULL_P
  | a_expr FOLLOWING OR NULL_P
    ;
opt_window_exclusion_clause:
    EXCLUDE CURRENT_P ROW
  | EXCLUDE GROUP_P
  | EXCLUDE TIES
  | EXCLUDE NO OTHERS
  | %empty
    ;
implicit_row:
    LRB expr_list COMMA a_expr RRB
    ;
explicit_row:
    ROW LRB row_constructor_list RRB
  | ROW LRB RRB
    ;
row_constructor_list:
    row_constructor_elem
  | row_constructor_list COMMA row_constructor_elem
    ;
row_constructor_elem:
    a_expr AS ColLabel
  | a_expr BareColLabel
  | a_expr
  | param_name EQUALS_GREATER a_expr
    ;
sub_type:
    ANY
  | SOME
  | ALL
    ;
all_Op:
    Op
  | MathOp
    ;
MathOp:
    PLUS
  | MINUS
  | STAR
  | DIVIDE
  | MODULO
  | CIRCUMFLEX
  | LESS_THAN
  | GREATER_THAN
  | EQUALS
  | AMPERSAND
  | PIPE
  | LESS_EQUALS
  | GREATER_EQUALS
  | NOT_EQUALS
    ;
qual_Op:
    Op
  | AMPERSAND
  | PIPE
  | OPERATOR LRB any_operator RRB
    ;
qual_all_Op:
    all_Op
  | OPERATOR LRB any_operator RRB
    ;
subquery_Op:
    all_Op
  | OPERATOR LRB any_operator RRB
  | LIKE
  | NOT_LA LIKE
  | ILIKE
  | NOT_LA ILIKE
    ;
any_operator:
    all_Op
  | ColId DOT any_operator
    ;
expr_list:
    a_expr
  | expr_list COMMA a_expr
    ;
func_arg_list:
    func_arg_list_item
  | func_arg_list COMMA func_arg_list_item
    ;
func_arg_list_item:
    func_arg_expr
  | param_name COLON_EQUALS func_arg_expr
  | param_name EQUALS_GREATER func_arg_expr
    ;
func_arg_expr:
    a_expr
  | descriptor
  | table_arg
  | LAMBDA opt_lambda_labels COLON a_expr
    ;
opt_lambda_labels:
    columnList
  | %empty
    ;
table_arg:
    TABLE LRB qualified_name RRB opt_table_arg_correlation opt_table_arg_partition opt_table_arg_order
  | TABLE LRB select_no_parens RRB opt_table_arg_correlation opt_table_arg_partition opt_table_arg_order
    ;
opt_table_arg_correlation:
    AS ColId
  | %empty
    ;
opt_table_arg_partition:
    PARTITION BY LRB expr_list RRB
  | %empty
    ;
opt_table_arg_order:
    ORDER BY LRB sortby_list RRB
  | %empty %prec EMPTY_PREC
    ;
type_list:
    Typename
  | type_list COMMA Typename
    ;
array_expr:
    LSB expr_list RSB
  | LSB array_expr_list RSB
  | LSB RSB
    ;
array_expr_list:
    array_expr
  | array_expr_list COMMA array_expr
    ;
extract_list:
    extract_arg FROM a_expr
  | extract_arg FROM a_expr COMMA func_arg_list
  | %empty
    ;
extract_arg:
    IDENT
  | YEAR_P
  | MONTH_P
  | DAY_P
  | HOUR_P
  | MINUTE_P
  | SECOND_P
  | Sconst
    ;
overlay_list:
    a_expr overlay_placing substr_from substr_for
  | a_expr overlay_placing substr_from
    ;
overlay_placing:
    PLACING a_expr
    ;
position_list:
    b_expr IN_P b_expr
  | b_expr IN_P b_expr COMMA func_arg_list
  | %empty
    ;
substr_list:
    a_expr substr_from substr_for
  | a_expr substr_for substr_from
  | a_expr substr_from
  | a_expr substr_for
  | a_expr substr_similar substr_escape
  | expr_list
  | %empty
    ;
substr_from:
    FROM a_expr
    ;
substr_for:
    FOR a_expr
    ;
substr_similar:
    SIMILAR a_expr
    ;
substr_escape:
    ESCAPE a_expr
    ;
trim_list:
    a_expr FROM expr_list
  | FROM expr_list
  | expr_list
    ;
in_expr:
    select_with_parens
  | LRB expr_list RRB
    ;
case_expr:
    CASE case_arg when_clause_list case_default END_P
    ;
when_clause_list:
    when_clause
  | when_clause_list when_clause
    ;
when_clause:
    WHEN a_expr THEN a_expr
    ;
case_default:
    ELSE a_expr
  | %empty
    ;
case_arg:
    a_expr
  | %empty
    ;
columnref_list:
    columnref
  | columnref_list COMMA columnref
    ;
columnref:
    ColId
  | ColId indirection
    ;
indirection_el:
    DOT attr_name
  | LSB a_expr RSB
  | LSB a_expr COLON a_expr RSB
    ;
indirection:
    indirection_el
  | indirection indirection_el
    ;
opt_indirection:
    %empty
  | opt_indirection indirection_el
    ;
opt_asymmetric:
    ASYMMETRIC
  | %empty
    ;
ctext_expr:
    a_expr
  | DEFAULT
    ;
ctext_expr_list:
    ctext_expr
  | ctext_expr_list COMMA ctext_expr
    ;
ctext_row:
    LRB ctext_expr_list RRB
    ;
json_value_expr:
    a_expr json_format_clause_opt
    ;
json_value_expr_list:
    json_value_expr
  | json_value_expr_list COMMA json_value_expr
    ;
json_format_clause_opt:
    FORMAT_LA JSON
  | %empty
    ;
json_key_uniqueness_constraint_opt:
    WITH UNIQUE KEYS
  | WITH UNIQUE %prec UNBOUNDED
  | WITHOUT UNIQUE KEYS
  | WITHOUT UNIQUE %prec UNBOUNDED
  | %empty %prec UNBOUNDED
    ;
json_name_and_value_list:
    json_name_and_value
  | json_name_and_value_list COMMA json_name_and_value
    ;
json_name_and_value:
    a_expr COLON json_value_expr
    ;
json_object_constructor_null_clause_opt:
    NULL_P ON NULL_P
  | ABSENT ON NULL_P
  | %empty
    ;
json_array_constructor_null_clause_opt:
    NULL_P ON NULL_P
  | ABSENT ON NULL_P
  | %empty
    ;
json_passing_clause_opt:
    PASSING json_arguments
  | %empty
    ;
json_arguments:
    json_argument
  | json_arguments COMMA json_argument
    ;
json_argument:
    a_expr AS ColId
    ;
json_returning_clause_opt:
    RETURNING Typename
  | %empty
    ;
json_wrapper_behavior:
    WITHOUT WRAPPER
  | WITHOUT ARRAY_LA WRAPPER
  | WITH WRAPPER
  | WITH ARRAY_LA WRAPPER
  | WITH CONDITIONAL ARRAY_LA WRAPPER
  | WITH UNCONDITIONAL ARRAY_LA WRAPPER
  | WITH CONDITIONAL WRAPPER
  | WITH UNCONDITIONAL WRAPPER
  | %empty
    ;
json_behavior:
    NULL_P
  | ERROR_P
  | TRUE_P
  | FALSE_P
  | UNKNOWN
  | EMPTY ARRAY
  | EMPTY OBJECT_P
  | DEFAULT a_expr
    ;
json_quotes_clause_opt:
    QUOTE
  | KEEP QUOTES
  | OMIT QUOTES
  | %empty
    ;
json_behavior_clause_opt:
    json_behavior ON EMPTY
  | json_behavior ON ERROR_P
  | json_behavior ON EMPTY json_behavior ON ERROR_P
  | %empty
    ;
json_on_error_clause_opt:
    json_behavior ON ERROR_P
  | %empty
    ;
opt_target_list:
    target_list
  | %empty
    ;
target_list:
    target_el
  | target_list COMMA target_el
    ;
target_el:
    a_expr AS ColLabel
  | a_expr BareColLabel
  | a_expr
  | STAR opt_star_exclude
  | columnref DOT_LA STAR opt_star_exclude
    ;
star_exclude:
    EXCLUDE columnref
  | EXCLUDE LRB columnref_list RRB
    ;
opt_star_exclude:
    %empty
  | star_exclude
    ;
qualified_name_list:
    qualified_name
  | qualified_name_list COMMA qualified_name
    ;
qualified_name:
    ColId
  | ColId indirection
    ;
name_list:
    name
  | name_list COMMA name
    ;
name:
    ColId
    ;
database_name:
    ColId
    ;
access_method:
    ColId
    ;
attr_name:
    ColLabel
    ;
index_name:
    ColId
    ;
func_name:
    type_function_name
  | ColId indirection
    ;
AexprConst:
    Iconst
  | FCONST
  | Sconst
  | BCONST
  | XCONST
  | func_name Sconst
  | func_name LRB func_arg_list opt_sort_clause opt_null_or_absent_on_null RRB Sconst
  | ConstTypename Sconst
  | ConstInterval Sconst opt_interval
  | ConstInterval LRB Iconst RRB Sconst
  | TRUE_P
  | FALSE_P
  | NULL_P
    ;
Iconst:
    ICONST
    ;
Sconst:
    SCONST
    ;
RoleId:
    NonReservedWord
    ;
role_list:
    RoleId
  | role_list COMMA RoleId
    ;
SignedIconst:
    Iconst
  | PLUS Iconst
  | MINUS Iconst
    ;
ColId:
    IDENT
  | unreserved_keyword
  | col_name_keyword
    ;
type_function_name:
    IDENT
  | unreserved_keyword
  | type_func_name_keyword
    ;
NonReservedWord:
    IDENT
  | unreserved_keyword
  | col_name_keyword
  | type_func_name_keyword
    ;
ColLabel:
    IDENT
  | unreserved_keyword
  | col_name_keyword
  | type_func_name_keyword
  | reserved_keyword
    ;
BareColLabel:
    IDENT
  | bare_label_keyword
    ;
unreserved_keyword:
    ABORT_P
  | ABSENT
  | ABSOLUTE_P
  | ACCESS
  | ACTION
  | ADD_P
  | ADMIN
  | AFTER
  | AGGREGATE
  | AGGREGATION_THRESHOLD
  | ALSO
  | ALTER
  | ALWAYS
  | ARE
  | ASSERTION
  | ASSIGNMENT
  | AT
  | ATTACH
  | ATTRIBUTE
  | BACKWARD
  | BEFORE
  | BEGIN_P
  | BUFFERED
  | BULK
  | BY
  | CACHE
  | CALL
  | CALLED
  | CASCADE
  | CASCADED
  | CATALOG_P
  | CHAIN
  | CHARACTERISTICS
  | CHECKPOINT
  | CLASS
  | CLOSE
  | CLUSTER
  | COLUMNS
  | COMMENT
  | COMMENTS
  | COMMIT
  | COMMITTED
  | CONDITIONAL
  | CONFIGURATION
  | CONNECTION
  | CONSTRAINTS
  | CONTENT_P
  | CONTINUE_P
  | CONVERSION_P
  | COPY
  | COST
  | CSV
  | CUBE
  | CURRENT_P
  | CURSOR
  | CYCLE
  | DATABASE
  | DATA_P
  | DAY_P
  | DEALLOCATE
  | DECLARE
  | DEFAULTS
  | DEFERRED
  | DEFINER
  | DELETE_P
  | DELIMITER
  | DELIMITERS
  | DESTINATION
  | DETACH
  | DICTIONARY
  | DIMENSIONS
  | DISABLE_P
  | DISCARD
  | DOCUMENT_P
  | DOMAIN_P
  | DOUBLE_P
  | DROP
  | EACH
  | EDGE
  | ENABLE_P
  | ENCODING
  | ENCRYPTED
  | ENUM_P
  | ERROR_P
  | ESCAPE
  | EVENT
  | EXCLUDE
  | EXCLUDING
  | EXCLUSIVE
  | EXECUTE
  | EXPLAIN
  | EXPORT
  | EXTENSION
  | EXTERNAL
  | FACTS
  | FAMILY
  | FILTER
  | FIRST_P
  | FOLLOWING
  | FORCE
  | FORMAT
  | FORWARD
  | FUNCTION
  | FUNCTIONS
  | GLOBAL
  | GRANTED
  | GRAPH
  | GROUPS
  | HANDLER
  | HEADER_P
  | HOLD
  | HOUR_P
  | IDENTITY_P
  | IF_P
  | IGNORE
  | IMMEDIATE
  | IMMUTABLE
  | IMPLICIT_P
  | IMPORT_P
  | INCLUDING
  | INCREMENT
  | INDEX
  | INDEXES
  | INHERIT
  | INHERITS
  | INLINE_P
  | INPUT_P
  | INSENSITIVE
  | INSERT
  | INSTEAD
  | INVOKER
  | ISOLATION
  | KEYS
  | LABEL
  | LANGUAGE
  | LARGE_P
  | LAST_P
  | LEAKPROOF
  | LEVEL
  | LISTEN
  | LOAD
  | LOCAL
  | LOCATION
  | LOCKED
  | LOCK_P
  | LOGGED
  | MAPPING
  | MATCH
  | MATCHED
  | MATERIALIZED
  | MAXVALUE
  | MEASURES
  | MERGE
  | MINUTE_P
  | MINVALUE
  | MODE
  | MONTH_P
  | MOVE
  | NAMES
  | NAME_P
  | NEXT
  | NO
  | NODE
  | NOTHING
  | NOTIFY
  | NOWAIT
  | NULLS_P
  | OBJECT_P
  | OF
  | OFF
  | OIDS
  | ONE
  | OPERATOR
  | OPTION
  | OPTIONS
  | ORDINALITY
  | OTHERS
  | OVER
  | OWNED
  | OWNER
  | PARSER
  | PARTIAL
  | PARTITION
  | PASSING
  | PASSWORD
  | PER
  | PERCENT
  | PLANS
  | POLICY
  | PRECEDING
  | PREPARE
  | PREPARED
  | PRESERVE
  | PRIOR
  | PRIVILEGES
  | PROCEDURAL
  | PROCEDURE
  | PROGRAM
  | PROPERTY
  | PROPERTIES
  | QUOTE
  | QUOTES
  | RANGE
  | READ
  | REASSIGN
  | RECHECK
  | RECURSIVE
  | REF
  | REFRESH
  | REINDEX
  | RELATIVE_P
  | RELATIONSHIP
  | RELEASE
  | RENAME
  | REPEATABLE
  | REPLACE
  | REPLICA
  | RESET
  | RESPECT
  | RESTART
  | RESTRICT
  | RETURNS
  | REVOKE
  | ROLE
  | ROLLBACK
  | ROLLUP
  | ROWS
  | RULE
  | SAVEPOINT
  | SCALAR
  | SCHEMA
  | SCROLL
  | SEARCH
  | SECOND_P
  | SECURE
  | SECURITY
  | SEQUENCE
  | SEQUENCES
  | SERIALIZABLE
  | SERVER
  | SESSION
  | SET
  | SETS
  | SHARE
  | SHOW
  | SIMPLE
  | SKIP
  | SNAPSHOT
  | SOURCE
  | STABLE
  | STANDALONE_P
  | START
  | STATEMENT
  | STATISTICS
  | STDIN
  | STDOUT
  | STEP
  | STORAGE
  | STRICT_P
  | STRIP_P
  | SYSID
  | SYSTEM_P
  | TABLES
  | TABLESPACE
  | TARGET
  | TEMP
  | TEMPLATE
  | TEMPORARY
  | TEXT_P
  | TIES
  | TRANSACTION
  | TRIGGER
  | TRUNCATE
  | TRUSTED
  | TYPES_P
  | TYPE_P
  | UNBOUNDED
  | UNCOMMITTED
  | UNCONDITIONAL
  | UNENCRYPTED
  | UNKNOWN
  | UNLISTEN
  | UNLOGGED
  | UNTIL
  | UPDATE
  | VACUUM
  | VALID
  | VALIDATE
  | VALIDATOR
  | VALUE_P
  | VARYING
  | VERSION_P
  | VIEW
  | VIEWS
  | VOLATILE
  | WHITESPACE_P
  | WITHIN
  | WITHOUT
  | WORK
  | WRAPPER
  | WRITE
  | XML_P
  | YEAR_P
  | YES_P
  | ZONE
  | BOUNDED
  | BREAK_P
  | CARDINALITY
  | DEFRAGMENTATION
  | EMPTY
  | EXPRESSIONS
  | FORCEFULLY
  | GRACEFULLY
  | KEEP
  | PASS
  | PRUNE
  | RETURN_P
  | SANITIZE
  | SEMANTICS
  | STREAM
  | THROUGH
  | THROUGHS
  | THROW
  | UNLOAD
  | VAR
  | VERTEX
  | WHILE
  | YIELD
    ;
col_name_keyword:
    BETWEEN
  | BIGINT
  | BIT
  | BOOLEAN_P
  | CHARACTER
  | CHAR_P
  | COALESCE
  | CONST
  | CONSTREF
  | DEC
  | DECIMAL_P
  | DESCRIPTOR
  | EXISTS
  | EXTRACT
  | FLOAT_P
  | GREATEST
  | GROUPING
  | INOUT
  | INTEGER
  | INTERVAL
  | INT_P
  | JSON
  | JSON_ARRAY
  | JSON_EXISTS
  | JSON_OBJECT
  | JSON_QUERY
  | JSON_SCALAR
  | JSON_VALUE
  | KEY
  | LEAST
  | NATIONAL
  | NCHAR
  | NONE
  | NTH_VALUE
  | NULLIF
  | NUMERIC
  | OUT_P
  | OVERLAY
  | POSITION
  | PRECISION
  | REAL
  | ROW
  | SETOF
  | SMALLINT
  | SUBSTRING
  | TIME
  | TIMESTAMP
  | TREAT
  | TRIM
  | TRY_CAST
  | VALUES
  | VARCHAR
  | XMLATTRIBUTES
  | XMLCONCAT
  | XMLELEMENT
  | XMLEXISTS
  | XMLFOREST
  | XMLPARSE
  | XMLPI
  | XMLROOT
  | XMLSERIALIZE
    ;
type_func_name_keyword:
    AUTHORIZATION
  | BINARY
  | COLLATION
  | CONCURRENTLY
  | CROSS
  | CURRENT_SCHEMA
  | FREEZE
  | FULL
  | ILIKE
  | INNER_P
  | IS
  | ISNULL
  | JOIN
  | LEFT
  | LIKE
  | NATURAL
  | NOTNULL
  | OUTER_P
  | OVERLAPS
  | RIGHT
  | SIMILAR
  | TABLESAMPLE
  | VERBOSE
    ;
reserved_keyword:
    ALL
  | ANALYSE
  | ANALYZE
  | AND
  | ANY
  | ARRAY
  | AS
  | ASC
  | ASSUMED
  | ASYMMETRIC
  | BOTH
  | CASE
  | CAST
  | CHECK
  | COLLATE
  | COLUMN
  | CONSTRAINT
  | CREATE
  | CURRENT_CATALOG
  | CURRENT_DATE
  | CURRENT_ROLE
  | CURRENT_TIME
  | CURRENT_TIMESTAMP
  | CURRENT_USER
  | DEFAULT
  | DEFERRABLE
  | DESC
  | DISTINCT
  | DO
  | ELSE
  | END_P
  | EXCEPT
  | FALSE_P
  | FETCH
  | FOR
  | FOREIGN
  | FROM
  | GRANT
  | GRAPH_TABLE
  | GROUP_P
  | HAVING
  | INITIALLY
  | INTERSECT
  | INTO
  | IN_P
  | LAMBDA
  | LATERAL_P
  | LEADING
  | LIMIT
  | LOCALTIME
  | LOCALTIMESTAMP
  | NOT
  | NULL_P
  | OFFSET
  | ON
  | ONLY
  | OMIT
  | OR
  | ORDER
  | PLACING
  | PRIMARY
  | REFERENCES
  | RETURNING
  | SELECT
  | SESSION_USER
  | SOME
  | SYMMETRIC
  | TABLE
  | THEN
  | TO
  | TRAILING
  | TRUE_P
  | UNION
  | UNIQUE
  | USER
  | USING
  | VARIADIC
  | WHEN
  | WHERE
  | WINDOW
  | WITH
    ;
bare_label_keyword:
    ABORT_P
  | ABSOLUTE_P
  | ACCESS
  | ACTION
  | ADD_P
  | ADMIN
  | AFTER
  | AGGREGATE
  | AGGREGATION_THRESHOLD
  | ALL
  | ALSO
  | ALTER
  | ALWAYS
  | ANALYSE
  | ANALYZE
  | AND
  | ANY
  | ARE
  | ASC
  | ASSERTION
  | ASSIGNMENT
  | ASYMMETRIC
  | AT
  | ATTACH
  | ATTRIBUTE
  | AUTHORIZATION
  | BACKWARD
  | BEFORE
  | BEGIN_P
  | BETWEEN
  | BIGINT
  | BINARY
  | BIT
  | BOOLEAN_P
  | BOTH
  | BY
  | CACHE
  | CALL
  | CALLED
  | CASCADE
  | CASCADED
  | CASE
  | CAST
  | CATALOG_P
  | CHAIN
  | CHARACTERISTICS
  | CHECK
  | CHECKPOINT
  | CLASS
  | CLOSE
  | CLUSTER
  | COALESCE
  | COLLATE
  | COLLATION
  | COLUMN
  | COLUMNS
  | COMMENT
  | COMMENTS
  | COMMIT
  | COMMITTED
  | CONCURRENTLY
  | CONDITIONAL
  | CONFIGURATION
  | CONNECTION
  | CONSTRAINT
  | CONSTRAINTS
  | CONTENT_P
  | CONTINUE_P
  | CONVERSION_P
  | COPY
  | COST
  | CROSS
  | CSV
  | CUBE
  | CURRENT_CATALOG
  | CURRENT_DATE
  | CURRENT_P
  | CURRENT_ROLE
  | CURRENT_SCHEMA
  | CURRENT_TIME
  | CURRENT_TIMESTAMP
  | CURRENT_USER
  | CURSOR
  | CYCLE
  | DATABASE
  | DATA_P
  | DEALLOCATE
  | DEC
  | DECIMAL_P
  | DECLARE
  | DEFAULT
  | DEFAULTS
  | DEFERRABLE
  | DEFERRED
  | DEFINER
  | DELETE_P
  | DELIMITER
  | DELIMITERS
  | DESC
  | DESTINATION
  | DETACH
  | DICTIONARY
  | DIMENSIONS
  | DISABLE_P
  | DISCARD
  | DISTINCT
  | DO
  | DOCUMENT_P
  | DOMAIN_P
  | DOUBLE_P
  | DROP
  | EACH
  | EDGE
  | ENABLE_P
  | ENCODING
  | ENCRYPTED
  | END_P
  | ENUM_P
  | ERROR_P
  | ESCAPE
  | EVENT
  | EXCLUDE
  | EXCLUDING
  | EXCLUSIVE
  | EXECUTE
  | EXISTS
  | EXPLAIN
  | EXPRESSIONS
  | EXTENSION
  | EXTERNAL
  | EXTRACT
  | FALSE_P
  | FACTS
  | FAMILY
  | FIRST_P
  | FLOAT_P
  | FOLLOWING
  | FORCE
  | FOREIGN
  | FORWARD
  | FREEZE
  | FULL
  | FUNCTION
  | FUNCTIONS
  | GLOBAL
  | GRANTED
  | GRAPH
  | GRAPH_TABLE
  | GREATEST
  | GROUPING
  | GROUPS
  | HANDLER
  | HEADER_P
  | HOLD
  | IDENTITY_P
  | IF_P
  | ILIKE
  | IMMEDIATE
  | IMMUTABLE
  | IMPLICIT_P
  | IMPORT_P
  | INCLUDING
  | INCREMENT
  | INDEX
  | INDEXES
  | INHERIT
  | INHERITS
  | INITIALLY
  | INLINE_P
  | INNER_P
  | INOUT
  | INPUT_P
  | INSENSITIVE
  | INSERT
  | INSTEAD
  | INTEGER
  | INTERVAL
  | INT_P
  | INVOKER
  | IN_P
  | IS
  | ISOLATION
  | JOIN
  | JSON
  | JSON_ARRAY
  | JSON_EXISTS
  | JSON_OBJECT
  | JSON_QUERY
  | JSON_SCALAR
  | JSON_VALUE
  | KEY
  | LABEL
  | LAMBDA
  | LANGUAGE
  | LARGE_P
  | LAST_P
  | LATERAL_P
  | LEADING
  | LEAKPROOF
  | LEAST
  | LEFT
  | LEVEL
  | LIKE
  | LISTEN
  | LOAD
  | LOCAL
  | LOCALTIME
  | LOCALTIMESTAMP
  | LOCATION
  | LOCKED
  | LOCK_P
  | LOGGED
  | MAPPING
  | MATCH
  | MATCHED
  | MATERIALIZED
  | MAXVALUE
  | MEASURES
  | MERGE
  | MINVALUE
  | MODE
  | MOVE
  | NAMES
  | NAME_P
  | NATIONAL
  | NATURAL
  | NCHAR
  | NEXT
  | NO
  | NODE
  | NONE
  | NOT
  | NOTHING
  | NOTIFY
  | NOWAIT
  | NULLIF
  | NULLS_P
  | NULL_P
  | NUMERIC
  | OBJECT_P
  | OF
  | OFF
  | OIDS
  | ONE
  | ONLY
  | OMIT
  | OPERATOR
  | OPTION
  | OPTIONS
  | OR
  | ORDINALITY
  | OTHERS
  | OUTER_P
  | OUT_P
  | OVERLAY
  | OWNED
  | OWNER
  | PARSER
  | PARTIAL
  | PARTITION
  | PASSING
  | PASSWORD
  | PER
  | PLACING
  | PLANS
  | POLICY
  | POSITION
  | PRECEDING
  | PREPARE
  | PREPARED
  | PRESERVE
  | PRIMARY
  | PRIOR
  | PRIVILEGES
  | PROCEDURAL
  | PROCEDURE
  | PROGRAM
  | PROPERTY
  | PROPERTIES
  | QUOTE
  | QUOTES
  | RANGE
  | READ
  | REAL
  | REASSIGN
  | RECHECK
  | RECURSIVE
  | REF
  | REFERENCES
  | REFRESH
  | REINDEX
  | RELATIVE_P
  | RELATIONSHIP
  | RELEASE
  | RENAME
  | REPEATABLE
  | REPLACE
  | REPLICA
  | RESET
  | RESTART
  | RESTRICT
  | RETURNS
  | REVOKE
  | RIGHT
  | ROLE
  | ROLLBACK
  | ROLLUP
  | ROW
  | ROWS
  | RULE
  | SAVEPOINT
  | SCALAR
  | SCHEMA
  | SCROLL
  | SEARCH
  | SECURITY
  | SELECT
  | SEQUENCE
  | SEQUENCES
  | SERIALIZABLE
  | SERVER
  | SESSION
  | SESSION_USER
  | SET
  | SETOF
  | SETS
  | SHARE
  | SHOW
  | SIMILAR
  | SIMPLE
  | SKIP
  | SMALLINT
  | SNAPSHOT
  | SOME
  | SOURCE
  | STABLE
  | STANDALONE_P
  | START
  | STATEMENT
  | STATISTICS
  | STDIN
  | STDOUT
  | STEP
  | STORAGE
  | STRICT_P
  | STRIP_P
  | SUBSTRING
  | SYMMETRIC
  | SYSID
  | SYSTEM_P
  | TABLE
  | TABLES
  | TABLESAMPLE
  | TABLESPACE
  | TARGET
  | TEMP
  | TEMPLATE
  | TEMPORARY
  | TEXT_P
  | THEN
  | TIES
  | TIME
  | TIMESTAMP
  | TRAILING
  | TRANSACTION
  | TREAT
  | TRIGGER
  | TRIM
  | TRUE_P
  | TRUNCATE
  | TRUSTED
  | TYPES_P
  | TYPE_P
  | UNBOUNDED
  | UNCOMMITTED
  | UNCONDITIONAL
  | UNENCRYPTED
  | UNIQUE
  | UNKNOWN
  | UNLISTEN
  | UNLOGGED
  | UNTIL
  | UPDATE
  | USER
  | USING
  | VACUUM
  | VALID
  | VALIDATE
  | VALIDATOR
  | VALUES
  | VALUE_P
  | VARCHAR
  | VARIADIC
  | VERBOSE
  | VERSION_P
  | VERTEX
  | VIEW
  | VIEWS
  | VOLATILE
  | WHEN
  | WHITESPACE_P
  | WORK
  | WRAPPER
  | WRITE
  | XMLATTRIBUTES
  | XMLCONCAT
  | XMLELEMENT
  | XMLEXISTS
  | XMLFOREST
  | XMLPARSE
  | XMLPI
  | XMLROOT
  | XMLSERIALIZE
  | XML_P
  | YES_P
  | ZONE
    ;
%%
