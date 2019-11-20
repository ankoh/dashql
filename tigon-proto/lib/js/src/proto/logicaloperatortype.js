// source: duckdb.proto
/**
 * @fileoverview
 * @enhanceable
 * @suppress {messageConventions} JS Compiler reports an error if a variable or
 *     field starts with 'MSG_' and isn't a translatable message.
 * @public
 */
// GENERATED CODE -- DO NOT EDIT!

goog.provide('proto.tigon.proto.duckdb.LogicalOperatorType');

/**
 * @enum {number}
 */
proto.tigon.proto.duckdb.LogicalOperatorType = {
  OP_INVALID: 0,
  OP_PROJECTION: 1,
  OP_FILTER: 2,
  OP_AGGREGATE_AND_GROUP_BY: 3,
  OP_WINDOW: 4,
  OP_LIMIT: 5,
  OP_ORDER_BY: 6,
  OP_TOP_N: 7,
  OP_COPY_FROM_FILE: 8,
  OP_COPY_TO_FILE: 9,
  OP_DISTINCT: 10,
  OP_INDEX_SCAN: 11,
  OP_GET: 12,
  OP_CHUNK_GET: 13,
  OP_DELIM_GET: 14,
  OP_EXPRESSION_GET: 15,
  OP_TABLE_FUNCTION: 16,
  OP_SUBQUERY: 17,
  OP_EMPTY_RESULT: 18,
  OP_JOIN: 19,
  OP_DELIM_JOIN: 20,
  OP_COMPARISON_JOIN: 21,
  OP_ANY_JOIN: 22,
  OP_CROSS_PRODUCT: 23,
  OP_UNION: 24,
  OP_EXCEPT: 25,
  OP_INTERSECT: 26,
  OP_INSERT: 27,
  OP_DELETE: 28,
  OP_UPDATE: 29,
  OP_CREATE_TABLE: 30,
  OP_CREATE_INDEX: 31,
  OP_EXPLAIN: 32,
  OP_PRUNE_COLUMNS: 33,
  OP_PREPARE: 34,
  OP_EXECUTE: 35
};

