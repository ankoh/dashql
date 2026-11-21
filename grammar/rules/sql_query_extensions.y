sql_bare_col_label:
    IDENT { name_from_identifier(@1, $1) }
  | ABORT_P { ctx.name_from_keyword(@1, $1) }
  | ABSOLUTE_P { ctx.name_from_keyword(@1, $1) }
  | ACCESS { ctx.name_from_keyword(@1, $1) }
  | ACTION { ctx.name_from_keyword(@1, $1) }
  | ADD_P { ctx.name_from_keyword(@1, $1) }
  | ADMIN { ctx.name_from_keyword(@1, $1) }
  | AFTER { ctx.name_from_keyword(@1, $1) }
  | AGGREGATE { ctx.name_from_keyword(@1, $1) }
  | AGGREGATION_THRESHOLD { ctx.name_from_keyword(@1, $1) }
  | ALL { ctx.name_from_keyword(@1, $1) }
  | ALSO { ctx.name_from_keyword(@1, $1) }
  | ALTER { ctx.name_from_keyword(@1, $1) }
  | ALWAYS { ctx.name_from_keyword(@1, $1) }
  | ANALYSE { ctx.name_from_keyword(@1, $1) }
  | ANALYZE { ctx.name_from_keyword(@1, $1) }
  | AND { ctx.name_from_keyword(@1, $1) }
  | ANY { ctx.name_from_keyword(@1, $1) }
  | ARE { ctx.name_from_keyword(@1, $1) }
  | ASC_P { ctx.name_from_keyword(@1, $1) }
  | ASSERTION { ctx.name_from_keyword(@1, $1) }
  | ASSIGNMENT { ctx.name_from_keyword(@1, $1) }
  | ASYMMETRIC { ctx.name_from_keyword(@1, $1) }
  | AT { ctx.name_from_keyword(@1, $1) }
  | ATTACH { ctx.name_from_keyword(@1, $1) }
  | ATTRIBUTE { ctx.name_from_keyword(@1, $1) }
  | AUTHORIZATION { ctx.name_from_keyword(@1, $1) }
  | BACKWARD { ctx.name_from_keyword(@1, $1) }
  | BEFORE { ctx.name_from_keyword(@1, $1) }
  | BEGIN_P { ctx.name_from_keyword(@1, $1) }
  | BETWEEN { ctx.name_from_keyword(@1, $1) }
  | BIGINT { ctx.name_from_keyword(@1, $1) }
  | BINARY { ctx.name_from_keyword(@1, $1) }
  | BIT { ctx.name_from_keyword(@1, $1) }
  | BOOLEAN_P { ctx.name_from_keyword(@1, $1) }
  | BOTH { ctx.name_from_keyword(@1, $1) }
  | BY { ctx.name_from_keyword(@1, $1) }
  | CACHE { ctx.name_from_keyword(@1, $1) }
  | CALL_P { ctx.name_from_keyword(@1, $1) }
  | CALLED { ctx.name_from_keyword(@1, $1) }
  | CASCADE { ctx.name_from_keyword(@1, $1) }
  | CASCADED { ctx.name_from_keyword(@1, $1) }
  | CASE { ctx.name_from_keyword(@1, $1) }
  | CAST { ctx.name_from_keyword(@1, $1) }
  | CATALOG_P { ctx.name_from_keyword(@1, $1) }
  | CHAIN { ctx.name_from_keyword(@1, $1) }
  | CHARACTERISTICS { ctx.name_from_keyword(@1, $1) }
  | CHECK_P { ctx.name_from_keyword(@1, $1) }
  | CHECKPOINT { ctx.name_from_keyword(@1, $1) }
  | CLASS { ctx.name_from_keyword(@1, $1) }
  | CLOSE { ctx.name_from_keyword(@1, $1) }
  | CLUSTER { ctx.name_from_keyword(@1, $1) }
  | COALESCE { ctx.name_from_keyword(@1, $1) }
  | COLLATE { ctx.name_from_keyword(@1, $1) }
  | COLLATION { ctx.name_from_keyword(@1, $1) }
  | COLUMN { ctx.name_from_keyword(@1, $1) }
  | COLUMNS { ctx.name_from_keyword(@1, $1) }
  | COMMENT { ctx.name_from_keyword(@1, $1) }
  | COMMENTS { ctx.name_from_keyword(@1, $1) }
  | COMMIT { ctx.name_from_keyword(@1, $1) }
  | COMMITTED { ctx.name_from_keyword(@1, $1) }
  | CONCURRENTLY { ctx.name_from_keyword(@1, $1) }
  | CONDITIONAL { ctx.name_from_keyword(@1, $1) }
  | CONFIGURATION { ctx.name_from_keyword(@1, $1) }
  | CONNECTION { ctx.name_from_keyword(@1, $1) }
  | CONSTRAINT { ctx.name_from_keyword(@1, $1) }
  | CONSTRAINTS { ctx.name_from_keyword(@1, $1) }
  | CONTENT_P { ctx.name_from_keyword(@1, $1) }
  | CONTINUE_P { ctx.name_from_keyword(@1, $1) }
  | CONVERSION_P { ctx.name_from_keyword(@1, $1) }
  | COPY { ctx.name_from_keyword(@1, $1) }
  | COST { ctx.name_from_keyword(@1, $1) }
  | CROSS { ctx.name_from_keyword(@1, $1) }
  | CSV { ctx.name_from_keyword(@1, $1) }
  | CUBE { ctx.name_from_keyword(@1, $1) }
  | CURRENT_CATALOG { ctx.name_from_keyword(@1, $1) }
  | CURRENT_DATE { ctx.name_from_keyword(@1, $1) }
  | CURRENT_P { ctx.name_from_keyword(@1, $1) }
  | CURRENT_ROLE { ctx.name_from_keyword(@1, $1) }
  | CURRENT_SCHEMA { ctx.name_from_keyword(@1, $1) }
  | CURRENT_TIME { ctx.name_from_keyword(@1, $1) }
  | CURRENT_TIMESTAMP { ctx.name_from_keyword(@1, $1) }
  | CURRENT_USER { ctx.name_from_keyword(@1, $1) }
  | CURSOR { ctx.name_from_keyword(@1, $1) }
  | CYCLE { ctx.name_from_keyword(@1, $1) }
  | DATABASE { ctx.name_from_keyword(@1, $1) }
  | DATA_P { ctx.name_from_keyword(@1, $1) }
  | DEALLOCATE { ctx.name_from_keyword(@1, $1) }
  | DEC { ctx.name_from_keyword(@1, $1) }
  | DECIMAL_P { ctx.name_from_keyword(@1, $1) }
  | DECLARE { ctx.name_from_keyword(@1, $1) }
  | DEFAULT { ctx.name_from_keyword(@1, $1) }
  | DEFAULTS { ctx.name_from_keyword(@1, $1) }
  | DEFERRABLE { ctx.name_from_keyword(@1, $1) }
  | DEFERRED { ctx.name_from_keyword(@1, $1) }
  | DEFINER { ctx.name_from_keyword(@1, $1) }
  | DELETE_P { ctx.name_from_keyword(@1, $1) }
  | DELIMITER { ctx.name_from_keyword(@1, $1) }
  | DELIMITERS { ctx.name_from_keyword(@1, $1) }
  | DESC_P { ctx.name_from_keyword(@1, $1) }
  | DESTINATION { ctx.name_from_keyword(@1, $1) }
  | DETACH { ctx.name_from_keyword(@1, $1) }
  | DICTIONARY { ctx.name_from_keyword(@1, $1) }
  | DIMENSIONS { ctx.name_from_keyword(@1, $1) }
  | DISABLE_P { ctx.name_from_keyword(@1, $1) }
  | DISCARD { ctx.name_from_keyword(@1, $1) }
  | DISTINCT { ctx.name_from_keyword(@1, $1) }
  | DO { ctx.name_from_keyword(@1, $1) }
  | DOCUMENT_P { ctx.name_from_keyword(@1, $1) }
  | DOMAIN_P { ctx.name_from_keyword(@1, $1) }
  | DOUBLE_P { ctx.name_from_keyword(@1, $1) }
  | DROP { ctx.name_from_keyword(@1, $1) }
  | EACH { ctx.name_from_keyword(@1, $1) }
  | EDGE { ctx.name_from_keyword(@1, $1) }
  | ENABLE_P { ctx.name_from_keyword(@1, $1) }
  | ENCODING { ctx.name_from_keyword(@1, $1) }
  | ENCRYPTED { ctx.name_from_keyword(@1, $1) }
  | END_P { ctx.name_from_keyword(@1, $1) }
  | ENUM_P { ctx.name_from_keyword(@1, $1) }
  | ERROR_P { ctx.name_from_keyword(@1, $1) }
  | ESCAPE { ctx.name_from_keyword(@1, $1) }
  | EVENT { ctx.name_from_keyword(@1, $1) }
  | EXCLUDE { ctx.name_from_keyword(@1, $1) }
  | EXCLUDING { ctx.name_from_keyword(@1, $1) }
  | EXCLUSIVE { ctx.name_from_keyword(@1, $1) }
  | EXECUTE { ctx.name_from_keyword(@1, $1) }
  | EXISTS { ctx.name_from_keyword(@1, $1) }
  | EXPLAIN { ctx.name_from_keyword(@1, $1) }
  | EXPRESSIONS { ctx.name_from_keyword(@1, $1) }
  | EXTENSION { ctx.name_from_keyword(@1, $1) }
  | EXTERNAL { ctx.name_from_keyword(@1, $1) }
  | EXTRACT { ctx.name_from_keyword(@1, $1) }
  | FALSE_P { ctx.name_from_keyword(@1, $1) }
  | FACTS { ctx.name_from_keyword(@1, $1) }
  | FAMILY { ctx.name_from_keyword(@1, $1) }
  | FIRST_P { ctx.name_from_keyword(@1, $1) }
  | FLOAT_P { ctx.name_from_keyword(@1, $1) }
  | FOLLOWING { ctx.name_from_keyword(@1, $1) }
  | FORCE { ctx.name_from_keyword(@1, $1) }
  | FOREIGN { ctx.name_from_keyword(@1, $1) }
  | FORWARD { ctx.name_from_keyword(@1, $1) }
  | FREEZE { ctx.name_from_keyword(@1, $1) }
  | FULL { ctx.name_from_keyword(@1, $1) }
  | FUNCTION { ctx.name_from_keyword(@1, $1) }
  | FUNCTIONS { ctx.name_from_keyword(@1, $1) }
  | GLOBAL { ctx.name_from_keyword(@1, $1) }
  | GRANTED { ctx.name_from_keyword(@1, $1) }
  | GRAPH { ctx.name_from_keyword(@1, $1) }
  | GRAPH_TABLE { ctx.name_from_keyword(@1, $1) }
  | GREATEST { ctx.name_from_keyword(@1, $1) }
  | GROUPING { ctx.name_from_keyword(@1, $1) }
  | GROUPS { ctx.name_from_keyword(@1, $1) }
  | HANDLER { ctx.name_from_keyword(@1, $1) }
  | HEADER_P { ctx.name_from_keyword(@1, $1) }
  | HOLD { ctx.name_from_keyword(@1, $1) }
  | IDENTITY_P { ctx.name_from_keyword(@1, $1) }
  | IF_P { ctx.name_from_keyword(@1, $1) }
  | ILIKE { ctx.name_from_keyword(@1, $1) }
  | IMMEDIATE { ctx.name_from_keyword(@1, $1) }
  | IMMUTABLE { ctx.name_from_keyword(@1, $1) }
  | IMPLICIT_P { ctx.name_from_keyword(@1, $1) }
  | IMPORT_P { ctx.name_from_keyword(@1, $1) }
  | INCLUDING { ctx.name_from_keyword(@1, $1) }
  | INCREMENT { ctx.name_from_keyword(@1, $1) }
  | INDEX { ctx.name_from_keyword(@1, $1) }
  | INDEXES { ctx.name_from_keyword(@1, $1) }
  | INHERIT { ctx.name_from_keyword(@1, $1) }
  | INHERITS { ctx.name_from_keyword(@1, $1) }
  | INITIALLY { ctx.name_from_keyword(@1, $1) }
  | INLINE_P { ctx.name_from_keyword(@1, $1) }
  | INNER_P { ctx.name_from_keyword(@1, $1) }
  | INOUT { ctx.name_from_keyword(@1, $1) }
  | INPUT_P { ctx.name_from_keyword(@1, $1) }
  | INSENSITIVE { ctx.name_from_keyword(@1, $1) }
  | INSERT { ctx.name_from_keyword(@1, $1) }
  | INSTEAD { ctx.name_from_keyword(@1, $1) }
  | INTEGER { ctx.name_from_keyword(@1, $1) }
  | INTERVAL { ctx.name_from_keyword(@1, $1) }
  | INT_P { ctx.name_from_keyword(@1, $1) }
  | INVOKER { ctx.name_from_keyword(@1, $1) }
  | IN_P { ctx.name_from_keyword(@1, $1) }
  | IS { ctx.name_from_keyword(@1, $1) }
  | ISOLATION { ctx.name_from_keyword(@1, $1) }
  | JOIN { ctx.name_from_keyword(@1, $1) }
  | JSON { ctx.name_from_keyword(@1, $1) }
  | JSON_ARRAY { ctx.name_from_keyword(@1, $1) }
  | JSON_EXISTS { ctx.name_from_keyword(@1, $1) }
  | JSON_OBJECT { ctx.name_from_keyword(@1, $1) }
  | JSON_QUERY { ctx.name_from_keyword(@1, $1) }
  | JSON_SCALAR { ctx.name_from_keyword(@1, $1) }
  | JSON_VALUE { ctx.name_from_keyword(@1, $1) }
  | KEY { ctx.name_from_keyword(@1, $1) }
  | LABEL { ctx.name_from_keyword(@1, $1) }
  | LAMBDA { ctx.name_from_keyword(@1, $1) }
  | LANGUAGE { ctx.name_from_keyword(@1, $1) }
  | LARGE_P { ctx.name_from_keyword(@1, $1) }
  | LAST_P { ctx.name_from_keyword(@1, $1) }
  | LATERAL_P { ctx.name_from_keyword(@1, $1) }
  | LEADING { ctx.name_from_keyword(@1, $1) }
  | LEAKPROOF { ctx.name_from_keyword(@1, $1) }
  | LEAST { ctx.name_from_keyword(@1, $1) }
  | LEFT { ctx.name_from_keyword(@1, $1) }
  | LEVEL { ctx.name_from_keyword(@1, $1) }
  | LIKE { ctx.name_from_keyword(@1, $1) }
  | LISTEN { ctx.name_from_keyword(@1, $1) }
  | LOAD { ctx.name_from_keyword(@1, $1) }
  | LOCAL { ctx.name_from_keyword(@1, $1) }
  | LOCALTIME { ctx.name_from_keyword(@1, $1) }
  | LOCALTIMESTAMP { ctx.name_from_keyword(@1, $1) }
  | LOCATION { ctx.name_from_keyword(@1, $1) }
  | LOCKED { ctx.name_from_keyword(@1, $1) }
  | LOCK_P { ctx.name_from_keyword(@1, $1) }
  | LOGGED { ctx.name_from_keyword(@1, $1) }
  | MAPPING { ctx.name_from_keyword(@1, $1) }
  | MATCH { ctx.name_from_keyword(@1, $1) }
  | MATCHED { ctx.name_from_keyword(@1, $1) }
  | MATERIALIZED { ctx.name_from_keyword(@1, $1) }
  | MAXVALUE { ctx.name_from_keyword(@1, $1) }
  | MEASURES { ctx.name_from_keyword(@1, $1) }
  | MERGE { ctx.name_from_keyword(@1, $1) }
  | MINVALUE { ctx.name_from_keyword(@1, $1) }
  | MODE { ctx.name_from_keyword(@1, $1) }
  | MOVE { ctx.name_from_keyword(@1, $1) }
  | NAMES { ctx.name_from_keyword(@1, $1) }
  | NAME_P { ctx.name_from_keyword(@1, $1) }
  | NATIONAL { ctx.name_from_keyword(@1, $1) }
  | NATURAL { ctx.name_from_keyword(@1, $1) }
  | NCHAR { ctx.name_from_keyword(@1, $1) }
  | NEXT { ctx.name_from_keyword(@1, $1) }
  | NO { ctx.name_from_keyword(@1, $1) }
  | NODE { ctx.name_from_keyword(@1, $1) }
  | NONE { ctx.name_from_keyword(@1, $1) }
  | NOT { ctx.name_from_keyword(@1, $1) }
  | NOTHING { ctx.name_from_keyword(@1, $1) }
  | NOTIFY { ctx.name_from_keyword(@1, $1) }
  | NOWAIT { ctx.name_from_keyword(@1, $1) }
  | NULLIF { ctx.name_from_keyword(@1, $1) }
  | NULLS_P { ctx.name_from_keyword(@1, $1) }
  | NULL_P { ctx.name_from_keyword(@1, $1) }
  | NUMERIC { ctx.name_from_keyword(@1, $1) }
  | OBJECT_P { ctx.name_from_keyword(@1, $1) }
  | OF { ctx.name_from_keyword(@1, $1) }
  | OFF { ctx.name_from_keyword(@1, $1) }
  | OIDS { ctx.name_from_keyword(@1, $1) }
  | ONE { ctx.name_from_keyword(@1, $1) }
  | ONLY { ctx.name_from_keyword(@1, $1) }
  | OMIT { ctx.name_from_keyword(@1, $1) }
  | OPERATOR { ctx.name_from_keyword(@1, $1) }
  | OPTION { ctx.name_from_keyword(@1, $1) }
  | OPTIONS { ctx.name_from_keyword(@1, $1) }
  | OR { ctx.name_from_keyword(@1, $1) }
  | ORDINALITY { ctx.name_from_keyword(@1, $1) }
  | OTHERS { ctx.name_from_keyword(@1, $1) }
  | OUTER_P { ctx.name_from_keyword(@1, $1) }
  | OUT_P { ctx.name_from_keyword(@1, $1) }
  | OVERLAY { ctx.name_from_keyword(@1, $1) }
  | OWNED { ctx.name_from_keyword(@1, $1) }
  | OWNER { ctx.name_from_keyword(@1, $1) }
  | PARSER { ctx.name_from_keyword(@1, $1) }
  | PARTIAL { ctx.name_from_keyword(@1, $1) }
  | PARTITION { ctx.name_from_keyword(@1, $1) }
  | PASSING { ctx.name_from_keyword(@1, $1) }
  | PASSWORD { ctx.name_from_keyword(@1, $1) }
  | PER { ctx.name_from_keyword(@1, $1) }
  | PLACING { ctx.name_from_keyword(@1, $1) }
  | PLANS { ctx.name_from_keyword(@1, $1) }
  | POLICY { ctx.name_from_keyword(@1, $1) }
  | POSITION { ctx.name_from_keyword(@1, $1) }
  | PRECEDING { ctx.name_from_keyword(@1, $1) }
  | PREPARE { ctx.name_from_keyword(@1, $1) }
  | PREPARED { ctx.name_from_keyword(@1, $1) }
  | PRESERVE { ctx.name_from_keyword(@1, $1) }
  | PRIMARY { ctx.name_from_keyword(@1, $1) }
  | PRIOR { ctx.name_from_keyword(@1, $1) }
  | PRIVILEGES { ctx.name_from_keyword(@1, $1) }
  | PROCEDURAL { ctx.name_from_keyword(@1, $1) }
  | PROCEDURE { ctx.name_from_keyword(@1, $1) }
  | PROGRAM { ctx.name_from_keyword(@1, $1) }
  | PROPERTY { ctx.name_from_keyword(@1, $1) }
  | PROPERTIES { ctx.name_from_keyword(@1, $1) }
  | QUOTE { ctx.name_from_keyword(@1, $1) }
  | QUOTES { ctx.name_from_keyword(@1, $1) }
  | RANGE { ctx.name_from_keyword(@1, $1) }
  | READ_P { ctx.name_from_keyword(@1, $1) }
  | REAL { ctx.name_from_keyword(@1, $1) }
  | REASSIGN { ctx.name_from_keyword(@1, $1) }
  | RECHECK { ctx.name_from_keyword(@1, $1) }
  | RECURSIVE { ctx.name_from_keyword(@1, $1) }
  | REF { ctx.name_from_keyword(@1, $1) }
  | REFERENCES { ctx.name_from_keyword(@1, $1) }
  | REFRESH { ctx.name_from_keyword(@1, $1) }
  | REINDEX { ctx.name_from_keyword(@1, $1) }
  | RELATIVE_P { ctx.name_from_keyword(@1, $1) }
  | RELATIONSHIP { ctx.name_from_keyword(@1, $1) }
  | RELEASE { ctx.name_from_keyword(@1, $1) }
  | RENAME { ctx.name_from_keyword(@1, $1) }
  | REPEATABLE { ctx.name_from_keyword(@1, $1) }
  | REPLACE { ctx.name_from_keyword(@1, $1) }
  | REPLICA { ctx.name_from_keyword(@1, $1) }
  | RESET { ctx.name_from_keyword(@1, $1) }
  | RESTART { ctx.name_from_keyword(@1, $1) }
  | RESTRICT { ctx.name_from_keyword(@1, $1) }
  | RETURNS { ctx.name_from_keyword(@1, $1) }
  | REVOKE { ctx.name_from_keyword(@1, $1) }
  | RIGHT { ctx.name_from_keyword(@1, $1) }
  | ROLE { ctx.name_from_keyword(@1, $1) }
  | ROLLBACK { ctx.name_from_keyword(@1, $1) }
  | ROLLUP { ctx.name_from_keyword(@1, $1) }
  | ROW { ctx.name_from_keyword(@1, $1) }
  | ROWS { ctx.name_from_keyword(@1, $1) }
  | RULE { ctx.name_from_keyword(@1, $1) }
  | SAVEPOINT { ctx.name_from_keyword(@1, $1) }
  | SCALAR { ctx.name_from_keyword(@1, $1) }
  | SCHEMA { ctx.name_from_keyword(@1, $1) }
  | SCROLL { ctx.name_from_keyword(@1, $1) }
  | SEARCH { ctx.name_from_keyword(@1, $1) }
  | SECURITY { ctx.name_from_keyword(@1, $1) }
  | SELECT { ctx.name_from_keyword(@1, $1) }
  | SEQUENCE { ctx.name_from_keyword(@1, $1) }
  | SEQUENCES { ctx.name_from_keyword(@1, $1) }
  | SERIALIZABLE { ctx.name_from_keyword(@1, $1) }
  | SERVER { ctx.name_from_keyword(@1, $1) }
  | SESSION { ctx.name_from_keyword(@1, $1) }
  | SESSION_USER { ctx.name_from_keyword(@1, $1) }
  | SET { ctx.name_from_keyword(@1, $1) }
  | SETOF { ctx.name_from_keyword(@1, $1) }
  | SETS { ctx.name_from_keyword(@1, $1) }
  | SHARE { ctx.name_from_keyword(@1, $1) }
  | SHOW { ctx.name_from_keyword(@1, $1) }
  | SIMILAR { ctx.name_from_keyword(@1, $1) }
  | SIMPLE { ctx.name_from_keyword(@1, $1) }
  | SKIP { ctx.name_from_keyword(@1, $1) }
  | SMALLINT { ctx.name_from_keyword(@1, $1) }
  | SNAPSHOT { ctx.name_from_keyword(@1, $1) }
  | SOME { ctx.name_from_keyword(@1, $1) }
  | SOURCE { ctx.name_from_keyword(@1, $1) }
  | STABLE { ctx.name_from_keyword(@1, $1) }
  | STANDALONE_P { ctx.name_from_keyword(@1, $1) }
  | START { ctx.name_from_keyword(@1, $1) }
  | STATEMENT { ctx.name_from_keyword(@1, $1) }
  | STATISTICS { ctx.name_from_keyword(@1, $1) }
  | STDIN { ctx.name_from_keyword(@1, $1) }
  | STDOUT { ctx.name_from_keyword(@1, $1) }
  | STEP { ctx.name_from_keyword(@1, $1) }
  | STORAGE { ctx.name_from_keyword(@1, $1) }
  | STRICT_P { ctx.name_from_keyword(@1, $1) }
  | STRIP_P { ctx.name_from_keyword(@1, $1) }
  | SUBSTRING { ctx.name_from_keyword(@1, $1) }
  | SYMMETRIC { ctx.name_from_keyword(@1, $1) }
  | SYSID { ctx.name_from_keyword(@1, $1) }
  | SYSTEM_P { ctx.name_from_keyword(@1, $1) }
  | TABLE { ctx.name_from_keyword(@1, $1) }
  | TABLES { ctx.name_from_keyword(@1, $1) }
  | TABLESAMPLE { ctx.name_from_keyword(@1, $1) }
  | TABLESPACE { ctx.name_from_keyword(@1, $1) }
  | TARGET { ctx.name_from_keyword(@1, $1) }
  | TEMP { ctx.name_from_keyword(@1, $1) }
  | TEMPLATE { ctx.name_from_keyword(@1, $1) }
  | TEMPORARY { ctx.name_from_keyword(@1, $1) }
  | TEXT_P { ctx.name_from_keyword(@1, $1) }
  | THEN { ctx.name_from_keyword(@1, $1) }
  | TIES { ctx.name_from_keyword(@1, $1) }
  | TIME { ctx.name_from_keyword(@1, $1) }
  | TIMESTAMP { ctx.name_from_keyword(@1, $1) }
  | TRAILING { ctx.name_from_keyword(@1, $1) }
  | TRANSACTION { ctx.name_from_keyword(@1, $1) }
  | TREAT { ctx.name_from_keyword(@1, $1) }
  | TRIGGER { ctx.name_from_keyword(@1, $1) }
  | TRIM { ctx.name_from_keyword(@1, $1) }
  | TRUE_P { ctx.name_from_keyword(@1, $1) }
  | TRUNCATE { ctx.name_from_keyword(@1, $1) }
  | TRUSTED { ctx.name_from_keyword(@1, $1) }
  | TYPES_P { ctx.name_from_keyword(@1, $1) }
  | TYPE_P { ctx.name_from_keyword(@1, $1) }
  | UNBOUNDED { ctx.name_from_keyword(@1, $1) }
  | UNCOMMITTED { ctx.name_from_keyword(@1, $1) }
  | UNCONDITIONAL { ctx.name_from_keyword(@1, $1) }
  | UNENCRYPTED { ctx.name_from_keyword(@1, $1) }
  | UNIQUE { ctx.name_from_keyword(@1, $1) }
  | UNKNOWN { ctx.name_from_keyword(@1, $1) }
  | UNLISTEN { ctx.name_from_keyword(@1, $1) }
  | UNLOGGED { ctx.name_from_keyword(@1, $1) }
  | UNTIL { ctx.name_from_keyword(@1, $1) }
  | UPDATE { ctx.name_from_keyword(@1, $1) }
  | USER { ctx.name_from_keyword(@1, $1) }
  | USING { ctx.name_from_keyword(@1, $1) }
  | VACUUM { ctx.name_from_keyword(@1, $1) }
  | VALID { ctx.name_from_keyword(@1, $1) }
  | VALIDATE { ctx.name_from_keyword(@1, $1) }
  | VALIDATOR { ctx.name_from_keyword(@1, $1) }
  | VALUES { ctx.name_from_keyword(@1, $1) }
  | VALUE_P { ctx.name_from_keyword(@1, $1) }
  | VARCHAR { ctx.name_from_keyword(@1, $1) }
  | VARIADIC { ctx.name_from_keyword(@1, $1) }
  | VERBOSE { ctx.name_from_keyword(@1, $1) }
  | VERSION_P { ctx.name_from_keyword(@1, $1) }
  | VERTEX { ctx.name_from_keyword(@1, $1) }
  | VIEW { ctx.name_from_keyword(@1, $1) }
  | VIEWS { ctx.name_from_keyword(@1, $1) }
  | VOLATILE { ctx.name_from_keyword(@1, $1) }
  | WHEN { ctx.name_from_keyword(@1, $1) }
  | WHITESPACE_P { ctx.name_from_keyword(@1, $1) }
  | WORK { ctx.name_from_keyword(@1, $1) }
  | WRAPPER { ctx.name_from_keyword(@1, $1) }
  | WRITE_P { ctx.name_from_keyword(@1, $1) }
  | XMLATTRIBUTES { ctx.name_from_keyword(@1, $1) }
  | XMLCONCAT { ctx.name_from_keyword(@1, $1) }
  | XMLELEMENT { ctx.name_from_keyword(@1, $1) }
  | XMLEXISTS { ctx.name_from_keyword(@1, $1) }
  | XMLFOREST { ctx.name_from_keyword(@1, $1) }
  | XMLPARSE { ctx.name_from_keyword(@1, $1) }
  | XMLPI { ctx.name_from_keyword(@1, $1) }
  | XMLROOT { ctx.name_from_keyword(@1, $1) }
  | XMLSERIALIZE { ctx.name_from_keyword(@1, $1) }
  | XML_P { ctx.name_from_keyword(@1, $1) }
  | YES_P { ctx.name_from_keyword(@1, $1) }
  | ZONE { ctx.name_from_keyword(@1, $1) }
  | XMLNAMESPACES { ctx.name_from_keyword(@1, $1) }
  | XMLTABLE { ctx.name_from_keyword(@1, $1) }
  | ANTI { ctx.name_from_keyword(@1, $1) }
  | SEMI { ctx.name_from_keyword(@1, $1) }
  | GLOB { ctx.name_from_keyword(@1, $1) }
  | CONFLICT { ctx.name_from_keyword(@1, $1) }
  | DEPENDS { ctx.name_from_keyword(@1, $1) }
  | DESCRIBE { ctx.name_from_keyword(@1, $1) }
  | EXTEND { ctx.name_from_keyword(@1, $1) }
  | GENERATED { ctx.name_from_keyword(@1, $1) }
  | METHOD { ctx.name_from_keyword(@1, $1) }
  | NEW { ctx.name_from_keyword(@1, $1) }
  | OLD { ctx.name_from_keyword(@1, $1) }
  | OVERRIDING { ctx.name_from_keyword(@1, $1) }
  | PARALLEL { ctx.name_from_keyword(@1, $1) }
  | PRAGMA_P { ctx.name_from_keyword(@1, $1) }
  | PUBLICATION { ctx.name_from_keyword(@1, $1) }
  | REFERENCING { ctx.name_from_keyword(@1, $1) }
  | SAMPLE { ctx.name_from_keyword(@1, $1) }
  | SCHEMAS { ctx.name_from_keyword(@1, $1) }
  | SQL_P { ctx.name_from_keyword(@1, $1) }
  | SUBSCRIPTION { ctx.name_from_keyword(@1, $1) }
  | TRANSFORM { ctx.name_from_keyword(@1, $1) }
    ;


sql_opt_aggregation_threshold:
    WITH_LA AGGREGATION_THRESHOLD { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_opt_star_exclude:
    EXCLUDE sql_columnref { ctx.array(@$, &[$2]) }
  | EXCLUDE LRB sql_columnref_list RRB { ctx.array(@$, $3) }
  | %empty { null() }
    ;
sql_columnref_list:
    sql_columnref { ctx.list(&[$1]) }
  | sql_columnref_list COMMA sql_columnref { ctx.push_back($1,$3); $1 }
    ;
sql_opt_not_null:
    NOT NULL_P { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_row_constructor_list:
    sql_row_constructor_item { ctx.list(&[$1]) }
  | sql_row_constructor_list COMMA sql_row_constructor_item { ctx.push_back($1,$3); $1 }
    ;
sql_row_constructor_item:
    sql_a_expr { ctx.expression($1) }
  | sql_a_expr AS sql_col_label {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROW_FIELD,
            &[
                attr(Key::SQL_ROW_FIELD_VALUE, ctx.expression($1)),
                attr(Key::SQL_ROW_FIELD_NAME, $3),
            ],
        )
    }
  | sql_a_expr sql_bare_col_label {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROW_FIELD,
            &[
                attr(Key::SQL_ROW_FIELD_VALUE, ctx.expression($1)),
                attr(Key::SQL_ROW_FIELD_NAME, $2),
            ],
        )
    }
  | sql_param_name EQUALS_GREATER sql_a_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROW_FIELD,
            &[
                attr(Key::SQL_ROW_FIELD_NAME, $1),
                attr(Key::SQL_ROW_FIELD_VALUE, ctx.expression($3)),
            ],
        )
    }
    ;
sql_opt_null_treatment:
    IGNORE NULLS_P { bool_node(@$,true) }
  | RESPECT NULLS_P { bool_node(@$,false) }
  | %empty { null() }
    ;
sql_opt_from_last:
    FROM FIRST_P { bool_node(@$,false) }
  | FROM LAST_P { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_required_over_clause:
    OVER sql_window_specification { $2 }
  | OVER sql_col_id { $2 }
    ;
sql_opt_window_exclusion:
    EXCLUDE CURRENT_P ROW { enum_node(@$,WindowExclusionMode::CURRENT_ROW) }
  | EXCLUDE GROUP_P { enum_node(@$,WindowExclusionMode::GROUP) }
  | EXCLUDE TIES { enum_node(@$,WindowExclusionMode::TIES) }
  | EXCLUDE NO OTHERS { enum_node(@$,WindowExclusionMode::NO_OTHERS) }
  | %empty { null() }
    ;
sql_opt_null_on_null:
    NULL_P ON NULL_P { bool_node(@$,false) }
  | ABSENT ON NULL_P { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_table_ordinality:
    WITH_LA ORDINALITY sql_opt_ordinality_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ORDINALITY,
            &[
                attr(Key::SQL_ORDINALITY_ENABLED, bool_node(@$, true)),
                attr(Key::SQL_ORDINALITY_NAME, $3),
            ],
        )
    }
  | %empty { null() }
    ;
sql_opt_ordinality_name:
    LRB sql_col_id RRB { $2 }
  | %empty { null() }
    ;
sql_table_ref_options:
    WITH_OPTIONS_LA OPTIONS LRB sql_scan_option_list RRB { ctx.array(@$,$4) }
  | %empty { null() }
    ;
sql_scan_option_list:
    sql_scan_option { ctx.list(&[$1]) }
  | sql_scan_option_list COMMA sql_scan_option { ctx.push_back($1,$3);$1 }
    ;
sql_scan_option:
    sql_param_name COLON_EQUALS sql_a_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GENERIC_OPTION,
            &[
                attr(Key::SQL_GENERIC_OPTION_KEY, $1),
                attr(Key::SQL_GENERIC_OPTION_VALUE, ctx.expression($3)),
            ],
        )
    }
  | sql_param_name EQUALS_GREATER sql_a_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GENERIC_OPTION,
            &[
                attr(Key::SQL_GENERIC_OPTION_KEY, $1),
                attr(Key::SQL_GENERIC_OPTION_VALUE, ctx.expression($3)),
            ],
        )
    }
    ;
sql_lambda_arg:
    LAMBDA sql_lambda_labels COLON sql_a_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_LAMBDA_EXPRESSION,
            &[
                attr(Key::SQL_LAMBDA_PARAM, ctx.array(@2, $2)),
                attr(Key::SQL_LAMBDA_BODY, ctx.expression($4)),
            ],
        )
    }
    ;
sql_lambda_labels:
    sql_name_list { $1 }
  | %empty { ctx.list(NO_NODES) }
    ;
sql_table_arg_correlation:
    AS sql_col_id { $2 }
  | %empty { null() }
    ;
sql_table_arg_partition:
    PARTITION BY LRB sql_expr_list RRB { ctx.array(@$,$4) }
  | %empty { null() }
    ;
sql_table_arg_order:
    ORDER BY LRB sql_sortby_list RRB { ctx.array(@$,$4) }
  | %empty %prec TABLE_ARG_EMPTY { null() }
    ;
sql_descriptor_list:
    sql_descriptor_item { ctx.list(&[$1]) }
  | sql_descriptor_list COMMA sql_descriptor_item { ctx.push_back($1,$3);$1 }
    ;
sql_descriptor_item:
    sql_table_func_element { $1 }
  | sql_nonreserved_word { ctx.object(@$,NodeType::OBJECT_SQL_COLUMN_DEF,&[attr(Key::SQL_COLUMN_DEF_NAME,$1)]) }
    ;
sql_nonreserved_word:
    sql_col_id { $1 }
  | sql_type_func_keywords { ctx.name_from_keyword(@1,$1) }
    ;

sql_sample_bounds:
    BETWEEN sql_a_expr_const ROWS AND sql_a_expr_const ROWS { ctx.list(&[attr(Key::SQL_SAMPLE_MIN_ROWS,ctx.expression($2)),attr(Key::SQL_SAMPLE_MAX_ROWS,ctx.expression($5))]) }
  | BETWEEN UNBOUNDED ROWS AND sql_a_expr_const ROWS { ctx.list(&[attr(Key::SQL_SAMPLE_MAX_ROWS,ctx.expression($5))]) }
  | BETWEEN sql_a_expr_const ROWS AND UNBOUNDED ROWS { ctx.list(&[attr(Key::SQL_SAMPLE_MIN_ROWS,ctx.expression($2))]) }
  | %empty { ctx.list(NO_NODES) }
    ;
sql_array_constructor:
    LSB sql_expr_list RSB { ctx.object(@$,NodeType::OBJECT_SQL_ARRAY_EXPRESSION,&[attr(Key::SQL_ARRAY_EXPRESSION_VALUES,ctx.array(@2,$2))]) }
  | LSB sql_array_constructor_list RSB { ctx.object(@$,NodeType::OBJECT_SQL_ARRAY_EXPRESSION,&[attr(Key::SQL_ARRAY_EXPRESSION_VALUES,ctx.array(@2,$2))]) }
  | LSB RSB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ARRAY_EXPRESSION,
            &[attr(Key::SQL_ARRAY_EXPRESSION_VALUES, ctx.array_ex(@$, NO_NODES, false, false))],
        )
    }
    ;
sql_array_constructor_list:
    sql_array_constructor { ctx.list(&[$1]) }
  | sql_array_constructor_list COMMA sql_array_constructor { ctx.push_back($1,$3);$1 }
    ;


sql_select_node: sql_select_stmt { ctx.object(@$,NodeType::OBJECT_SQL_SELECT,$1) } ;
sql_select_parens_node: sql_select_with_parens { ctx.object(@$,NodeType::OBJECT_SQL_SELECT,$1) } ;
sql_expression_node: sql_a_expr { ctx.expression($1) } ;
sql_word_or_string: sql_nonreserved_word { $1 } | SCONST { const_node(@1,AConstType::STRING) } ;
sql_integer_literal: ICONST { const_node(@1,AConstType::INTEGER) } ;
sql_string_literal: SCONST { const_node(@1,AConstType::STRING) } | DCONST { const_node(@1,AConstType::STRING) } ;
sql_optional_with_clause: sql_with_clause { $1 } | %empty { ctx.list(NO_NODES) } ;
sql_column_def_list: sql_column_def { ctx.list(&[$1]) } | sql_column_def_list COMMA sql_column_def { ctx.push_back($1,$3);$1 } ;
sql_partition_expressions: PARTITION BY sql_expr_list { ctx.array(@$,$3) } | %empty { null() } ;
sql_optional_table_columns: sql_table_func_element_list { $1 } | %empty { ctx.list(NO_NODES) } ;
sql_argument_value: sql_a_expr { ctx.expression($1) } | sql_relation_arg { $1 } | sql_descriptor_arg { $1 } | sql_lambda_arg { $1 } ;
sql_setting_value: sql_word_or_string { $1 } | TRUE_P { bool_node(@1,true) } | FALSE_P { bool_node(@1,false) } | ON { bool_node(@1,true) } ;

sql_cardinality_hint:
    LRB WITH LRB CARDINALITY sql_numeric_only RRB RRB { $5 }
  | WITH CARDINALITY sql_integer_literal { $3 }
  | %empty %prec SET { null() }
    ;
sql_semantic_view: sql_func_name LRB sql_col_id sql_semantic_clauses RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEMANTIC_VIEW,
            &[
                attr(Key::SQL_SEMANTIC_VIEW_NAME, ctx.array(@1, $1)),
                attr(Key::SQL_SEMANTIC_VIEW_MODEL, $3),
                attr(Key::SQL_SEMANTIC_VIEW_CLAUSES, ctx.array(@4, $4)),
            ],
        )
    }
 | sql_func_name LRB SCONST sql_semantic_clauses RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEMANTIC_VIEW,
            &[
                attr(Key::SQL_SEMANTIC_VIEW_NAME, ctx.array(@1, $1)),
                attr(Key::SQL_SEMANTIC_VIEW_SPECIFICATION, const_node(@3, AConstType::STRING)),
                attr(Key::SQL_SEMANTIC_VIEW_CLAUSES, ctx.array(@4, $4)),
            ],
        )
    };
sql_semantic_clauses: sql_semantic_clause { ctx.list(&[$1]) } | sql_semantic_clauses sql_semantic_clause { ctx.push_back($1,$2); $1 };
sql_semantic_clause: DIMENSIONS sql_semantic_targets { ctx.object(@$,NodeType::OBJECT_SQL_SEMANTIC_DIMENSIONS,&[attr(Key::SQL_SEMANTIC_CLAUSE_TARGETS,ctx.array(@2,$2))]) }
 | MEASURES sql_semantic_targets { ctx.object(@$,NodeType::OBJECT_SQL_SEMANTIC_MEASURES,&[attr(Key::SQL_SEMANTIC_CLAUSE_TARGETS,ctx.array(@2,$2))]) }
 | FACTS sql_semantic_targets { ctx.object(@$,NodeType::OBJECT_SQL_SEMANTIC_FACTS,&[attr(Key::SQL_SEMANTIC_CLAUSE_TARGETS,ctx.array(@2,$2))]) }
 | WHERE sql_a_expr { ctx.object(@$,NodeType::OBJECT_SQL_SEMANTIC_FILTER,&[attr(Key::SQL_SEMANTIC_CLAUSE_CONDITION,ctx.expression($2))]) };
sql_semantic_targets: sql_semantic_target { ctx.list(&[$1]) } | sql_semantic_targets COMMA sql_semantic_target { ctx.push_back($1,$3); $1 };
sql_semantic_target: sql_a_expr { ctx.object(@$,NodeType::OBJECT_SQL_RESULT_TARGET,&[attr(Key::SQL_RESULT_TARGET_VALUE,ctx.expression($1))]) }
 | sql_a_expr AS sql_col_label {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RESULT_TARGET,
            &[
                attr(Key::SQL_RESULT_TARGET_VALUE, ctx.expression($1)),
                attr(Key::SQL_RESULT_TARGET_NAME, $3),
            ],
        )
    };
