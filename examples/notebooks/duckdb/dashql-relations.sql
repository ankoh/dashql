-- DashQL Connection Relations.
-- This file is auto-generated and can only be updated through a catalog refresh.
--
-- Catalog Source: SQL information_schema
-- Last Refresh: 2026-08-26T07:52:50.590Z

CREATE TABLE "memory"."main"."__col_agg_10" (
    "key" VARCHAR,
    "keyId" INTEGER,
    "count" INTEGER
);

CREATE TABLE "memory"."main"."__col_agg_14" (
    "bin" INTEGER,
    "count" INTEGER,
    "binWidth" FLOAT,
    "binLowerBound" FLOAT,
    "binUpperBound" FLOAT
);

CREATE TABLE "memory"."main"."__col_agg_3" (
    "bin" INTEGER,
    "count" INTEGER,
    "binWidth" FLOAT,
    "binLowerBound" FLOAT,
    "binUpperBound" FLOAT
);

CREATE TABLE "memory"."main"."__col_agg_4" (
    "key" VARCHAR,
    "keyId" INTEGER,
    "count" INTEGER
);

CREATE TABLE "memory"."main"."__col_agg_5" (
    "key" VARCHAR,
    "keyId" INTEGER,
    "count" INTEGER
);

CREATE TABLE "memory"."main"."__col_agg_6" (
    "bin" INTEGER,
    "count" INTEGER,
    "binWidth" FLOAT,
    "binLowerBound" FLOAT,
    "binUpperBound" FLOAT
);

CREATE TABLE "memory"."main"."__col_agg_7" (
    "key" VARCHAR,
    "keyId" INTEGER,
    "count" INTEGER
);

CREATE TABLE "memory"."main"."__col_agg_8" (
    "key" VARCHAR,
    "keyId" INTEGER,
    "count" INTEGER
);

CREATE TABLE "memory"."main"."__col_agg_9" (
    "key" VARCHAR,
    "keyId" INTEGER,
    "count" INTEGER
);

CREATE TABLE "memory"."main"."__input_0" (
    "s_acctbal" FLOAT,
    "s_name" VARCHAR,
    "n_name" VARCHAR,
    "p_partkey" INTEGER,
    "p_mfgr" VARCHAR,
    "s_address" VARCHAR,
    "s_phone" VARCHAR,
    "s_comment" VARCHAR
);

CREATE TABLE "memory"."main"."__input_11" (
    "Count" INTEGER
);

CREATE TABLE "memory"."main"."__syscols_13" (
    "Count" INTEGER,
    "_rownum" INTEGER,
    "_1_bin" FLOAT
);

CREATE TABLE "memory"."main"."__syscols_2" (
    "s_acctbal" FLOAT,
    "s_name" VARCHAR,
    "n_name" VARCHAR,
    "p_partkey" INTEGER,
    "p_mfgr" VARCHAR,
    "s_address" VARCHAR,
    "s_phone" VARCHAR,
    "s_comment" VARCHAR,
    "_rownum" INTEGER,
    "_2_id" INTEGER,
    "_3_id" INTEGER,
    "_5_id" INTEGER,
    "_6_id" INTEGER,
    "_7_id" INTEGER,
    "_8_id" INTEGER,
    "_1_bin" FLOAT,
    "_4_bin" FLOAT
);

CREATE TABLE "memory"."main"."__tbl_agg_1" (
    "_count" INTEGER,
    "_0_count" INTEGER,
    "_0_min" FLOAT,
    "_0_max" FLOAT,
    "_1_count" INTEGER,
    "_1_countd" INTEGER,
    "_2_count" INTEGER,
    "_2_countd" INTEGER,
    "_3_count" INTEGER,
    "_3_min" INTEGER,
    "_3_max" INTEGER,
    "_4_count" INTEGER,
    "_4_countd" INTEGER,
    "_5_count" INTEGER,
    "_5_countd" INTEGER,
    "_6_count" INTEGER,
    "_6_countd" INTEGER,
    "_7_count" INTEGER,
    "_7_countd" INTEGER
);

CREATE TABLE "memory"."main"."__tbl_agg_12" (
    "_count" INTEGER,
    "_0_count" INTEGER,
    "_0_min" INTEGER,
    "_0_max" INTEGER
);

CREATE TABLE "memory"."main"."test_table" (
    "some_attribute" VARCHAR
);