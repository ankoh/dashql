#include "dashql/view/plan_view_model.h"

#include <flatbuffers/flatbuffer_builder.h>

#include <algorithm>
#include <cmath>
#include <vector>

#include "gtest/gtest.h"

using namespace dashql;

namespace {

flatbuffers::FlatBufferBuilder PackPlan(std::string_view plan) {
    PlanViewModel model;
    buffers::view::PlanLayoutConfig config;
    config.mutate_level_height(64.0);
    config.mutate_node_height(32.0);
    config.mutate_node_padding_left(8.0);
    config.mutate_node_padding_right(8.0);
    config.mutate_max_label_chars(20);
    config.mutate_width_per_label_char(8.5);
    model.Configure(config);
    model.ParseHyperPlan(plan);
    model.ComputeLayout();
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(model.Pack(builder));
    return builder;
}

flatbuffers::FlatBufferBuilder PackPlan(std::string_view plan, const buffers::view::PlanLayoutConfig& config) {
    PlanViewModel model;
    model.Configure(config);
    model.ParseHyperPlan(plan);
    model.ComputeLayout();
    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(model.Pack(builder));
    return builder;
}

buffers::view::PlanLayoutConfig MakeLayoutConfig(double margin) {
    buffers::view::PlanLayoutConfig config;
    config.mutate_level_height(20.0);
    config.mutate_node_height(8.0);
    config.mutate_node_margin_horizontal(margin);
    config.mutate_node_padding_left(0.25);
    config.mutate_node_padding_right(0.25);
    config.mutate_max_label_chars(20);
    config.mutate_width_per_label_char(1.25);
    return config;
}

void ExpectSameLevelNodesDoNotOverlap(const buffers::view::PlanViewModel& plan, double margin) {
    auto* operators = plan.operators();
    ASSERT_NE(operators, nullptr);
    for (size_t i = 0; i < operators->size(); ++i) {
        const auto& left = operators->Get(i)->layout_rect();
        for (size_t j = i + 1; j < operators->size(); ++j) {
            const auto& right = operators->Get(j)->layout_rect();
            if (std::abs(left.y() - right.y()) > 0.001) continue;
            const auto* first = &left;
            const auto* second = &right;
            if (first->x() > second->x()) std::swap(first, second);
            EXPECT_GE(second->x() - second->width() / 2, first->x() + first->width() / 2 + margin - 0.001)
                << "operators " << i << " and " << j;
        }
    }
}

void ExpectBoundsContainNodes(const buffers::view::PlanViewModel& plan) {
    const auto* bounds = plan.layout_rect();
    ASSERT_NE(bounds, nullptr);
    ASSERT_NE(plan.operators(), nullptr);
    for (const auto* op : *plan.operators()) {
        const auto& rect = op->layout_rect();
        EXPECT_GE(rect.x() - rect.width() / 2, bounds->x() - 0.001);
        EXPECT_LE(rect.x() + rect.width() / 2, bounds->x() + bounds->width() + 0.001);
    }
}

TEST(HyperPlanTest, ExplicitPipelinesAndProperties) {
    auto builder = PackPlan(R"JSON({
        "operator":"executiontarget","operatorId":1,"cardinality":5,
        "input":{"operator":"tablescan","operatorId":2,"metadata":{"cost":1}},
        "pipelines":[{"pipelineId":10,"operators":[2,1]}]
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());
    ASSERT_EQ(plan->operators()->size(), 2);
    ASSERT_EQ(plan->pipelines()->size(), 1);
    EXPECT_EQ(plan->pipelines()->Get(0)->operator_count(), 2);
    EXPECT_EQ(plan->pipeline_operators()->Get(0), 0);
    EXPECT_EQ(plan->pipeline_operators()->Get(1), 1);
    EXPECT_EQ(plan->pipelines()->Get(0)->edge_count(), 1);
    EXPECT_EQ(plan->pipeline_edges()->Get(0)->child_operator(), 0);
    EXPECT_EQ(plan->pipeline_edges()->Get(0)->parent_operator(), 1);
    EXPECT_GT(plan->operators()->Get(0)->attribute_count(), 0);
}

TEST(HyperPlanTest, LegacyPlansDoNotInferPipelines) {
    auto builder = PackPlan(R"JSON({
        "operator":"executiontarget","operatorId":1,
        "input":{"operator":"tablescan","operatorId":2}
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());
    EXPECT_EQ(plan->operators()->size(), 2);
    EXPECT_EQ(plan->fragments()->size(), 0);
    EXPECT_EQ(plan->pipelines()->size(), 0);
}

TEST(HyperPlanTest, FederateCreatesFragmentFromReachableChildren) {
    auto builder = PackPlan(R"JSON({
        "operator":"output",
        "inputs":[{
            "inputs":[{
                "operator":"join",
                "left":{"operator":"scan"},
                "right":{"operator":"scan"}
            }],
            "operator":"federate"
        }]
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    ASSERT_EQ(plan->fragments()->size(), 1);
    const auto* fragment = plan->fragments()->Get(0);
    EXPECT_EQ(fragment->fragment_id(), 0);
    ASSERT_EQ(fragment->operator_count(), 4);
    EXPECT_EQ(plan->fragment_operators()->Get(fragment->operators_begin()), 3);
    EXPECT_EQ(plan->fragment_operators()->Get(fragment->operators_begin() + 1), 2);
    EXPECT_EQ(plan->fragment_operators()->Get(fragment->operators_begin() + 2), 0);
    EXPECT_EQ(plan->fragment_operators()->Get(fragment->operators_begin() + 3), 1);
}

TEST(HyperPlanTest, SiblingFederatesCreateDistinctFragments) {
    auto builder = PackPlan(R"JSON({
        "operator":"join",
        "left":{"operator":"federate","inputs":[{"operator":"scan"}]},
        "right":{"operator":"federate","inputs":[{"operator":"map","input":{"operator":"scan"}}]}
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    ASSERT_EQ(plan->fragments()->size(), 2);
    const auto* left = plan->fragments()->Get(0);
    ASSERT_EQ(left->operator_count(), 2);
    EXPECT_EQ(plan->fragment_operators()->Get(left->operators_begin()), 3);
    EXPECT_EQ(plan->fragment_operators()->Get(left->operators_begin() + 1), 0);
    const auto* right = plan->fragments()->Get(1);
    ASSERT_EQ(right->operator_count(), 3);
    EXPECT_EQ(plan->fragment_operators()->Get(right->operators_begin()), 4);
    EXPECT_EQ(plan->fragment_operators()->Get(right->operators_begin() + 1), 2);
    EXPECT_EQ(plan->fragment_operators()->Get(right->operators_begin() + 2), 1);
}

TEST(HyperPlanTest, NestedFederatesHaveOverlappingFragments) {
    auto builder = PackPlan(R"JSON({
        "operator":"federate",
        "inputs":[{
            "operator":"map",
            "input":{"operator":"federate","inputs":[{"operator":"scan"}]}
        }]
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    ASSERT_EQ(plan->fragments()->size(), 2);
    const auto* outer = plan->fragments()->Get(0);
    ASSERT_EQ(outer->operator_count(), 4);
    EXPECT_EQ(plan->fragment_operators()->Get(outer->operators_begin()), 3);
    EXPECT_EQ(plan->fragment_operators()->Get(outer->operators_begin() + 1), 2);
    EXPECT_EQ(plan->fragment_operators()->Get(outer->operators_begin() + 2), 1);
    EXPECT_EQ(plan->fragment_operators()->Get(outer->operators_begin() + 3), 0);
    const auto* inner = plan->fragments()->Get(1);
    ASSERT_EQ(inner->operator_count(), 2);
    EXPECT_EQ(plan->fragment_operators()->Get(inner->operators_begin()), 1);
    EXPECT_EQ(plan->fragment_operators()->Get(inner->operators_begin() + 1), 0);
}

TEST(HyperPlanTest, InfersScanLabelFromDefinedAttributes) {
    auto builder = PackPlan(R"JSON({
        "operator":"output",
        "operator-id":1,
        "inputs":[{
            "operator":"scan",
            "operator-id":2,
            "type":"parquet",
            "attributes":[
                {"defines":{"id":"partsupp.partkey","type":{"type":"bigint"}},"name":"ps_partkey"},
                {"defines":{"id":"partsupp.suppkey","type":{"type":"bigint"}},"name":"ps_suppkey"}
            ]
        }]
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    ASSERT_EQ(plan->operators()->size(), 2);
    const auto* scan = plan->operators()->Get(0);
    ASSERT_NE(scan->operator_label(), std::numeric_limits<uint32_t>::max());
    EXPECT_EQ(plan->string_dictionary()->Get(scan->operator_label())->string_view(), "partsupp");
}

TEST(HyperPlanTest, ReadsKebabCaseDebugName) {
    auto builder = PackPlan(R"JSON({
        "operator":"parquetscan",
        "operator-id":15,
        "attributes":[
            {"col-id":0,"name":"s_suppkey","iu":["supplier.suppkey",["BigInt","nullable"]]},
            {"col-id":3,"name":"s_nationkey","iu":["supplier.nationke",["Integer","nullable"]]}
        ],
        "debug-name":{"classification":"customer","value":"supplier"}
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    ASSERT_EQ(plan->operators()->size(), 1);
    const auto* scan = plan->operators()->Get(0);
    ASSERT_NE(scan->operator_label(), std::numeric_limits<uint32_t>::max());
    EXPECT_EQ(plan->string_dictionary()->Get(scan->operator_label())->string_view(), "supplier");
}

TEST(HyperPlanTest, ExposesOperatorStatistics) {
    auto builder = PackPlan(R"JSON({
        "operator":"parquetscan",
        "operator-id":15,
        "estimated-rows":10000.5,
        "estimated-rows-in-table":12000.25,
        "statistics":{
            "pipeline":8,
            "column-count":2,
            "memory-bytes":4294967297,
            "output-rows":1987,
            "processed-rows":10000,
            "rows-matching-restrictions":1987,
            "running":false
        }
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    ASSERT_EQ(plan->operators()->size(), 1);
    const auto& statistics = plan->operators()->Get(0)->execution_statistics();
    EXPECT_DOUBLE_EQ(statistics.input_cardinality_estimated(), 12000.25);
    EXPECT_EQ(statistics.input_cardinality_consumed(), 10000);
    EXPECT_DOUBLE_EQ(statistics.output_cardinality_estimated(), 10000.5);
    EXPECT_EQ(statistics.output_cardinality_produced(), 1987);
    EXPECT_EQ(statistics.memory_bytes(), 4294967297);

    bool found_raw_statistics = false;
    const auto* op = plan->operators()->Get(0);
    for (size_t i = 0; i < op->attribute_count(); ++i) {
        const auto* attribute = plan->attributes()->Get(op->attributes_begin() + i);
        auto name = plan->string_dictionary()->Get(attribute->name())->string_view();
        found_raw_statistics |= name == "statistics";
    }
    EXPECT_TRUE(found_raw_statistics);
}

TEST(HyperPlanTest, ReadsNestedEstimatedStatistics) {
    auto builder = PackPlan(R"JSON({
        "operator":"scan",
        "statistics":{"estimated-rows":4.8375,"estimated-rows-in-table":25}
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    const auto& statistics = plan->operators()->Get(0)->execution_statistics();
    EXPECT_DOUBLE_EQ(statistics.input_cardinality_estimated(), 25);
    EXPECT_DOUBLE_EQ(statistics.output_cardinality_estimated(), 4.8375);
}

TEST(HyperPlanTest, ReadsCamelCaseMemoryBytes) {
    auto builder = PackPlan(R"JSON({
        "operator":"scan",
        "statistics":{"memoryBytes":2048}
    })JSON");
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    EXPECT_EQ(plan->operators()->Get(0)->execution_statistics().memory_bytes(), 2048);
}

TEST(HyperPlanTest, VariableWidthNodesDoNotOverlap) {
    constexpr double margin = 0.25;
    auto config = MakeLayoutConfig(margin);
    auto builder = PackPlan(R"JSON({
        "operator":"unionall",
        "input":[
            {"operator":"map","input":{"operator":"map","input":{"operator":"tablescan","debugName":{"value":"a_very_long_table"}}}},
            {"operator":"map","input":{"operator":"tablescan","debugName":{"value":"x"}}},
            {"operator":"tablescan","debugName":{"value":"medium_table"}}
        ]
    })JSON",
                            config);
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    ExpectSameLevelNodesDoNotOverlap(*plan, margin);
    ExpectBoundsContainNodes(*plan);
}

TEST(HyperPlanTest, IndependentRootsArePackedWithoutOverlap) {
    constexpr double margin = 0.5;
    auto config = MakeLayoutConfig(margin);
    auto builder = PackPlan(R"JSON([
        {"operator":"tablescan","debugName":{"value":"first_table"}},
        {"operator":"tablescan","debugName":{"value":"second_table_is_wider"}}
    ])JSON",
                            config);
    auto* plan = flatbuffers::GetRoot<buffers::view::PlanViewModel>(builder.GetBufferPointer());

    ASSERT_EQ(plan->root_operators()->size(), 2);
    ExpectSameLevelNodesDoNotOverlap(*plan, margin);
    ExpectBoundsContainNodes(*plan);
}

TEST(HyperPlanTest, TPCHQ18) {
    std::string_view plan =
        R"HYPERPLAN({"operator":"executiontarget","operatorId":1,"cardinality":100,"producesRows":true,"output":[{"expression":"iuref","iu":["v",["Varchar",25]]},{"expression":"iuref","iu":["v2",["Integer"]]},{"expression":"iuref","iu":["v3",["Integer"]]},{"expression":"iuref","iu":["v4",["Date"]]},{"expression":"iuref","iu":["v5",["Numeric",12,2]]},{"expression":"iuref","iu":["v6",["BigNumeric",38,2]]}],"outputNames":["c_name","c_custkey","o_orderkey","o_orderdate","o_totalprice","sum"],"input":{"operator":"sort","operatorId":2,"sqlpos":[[777,794],[816,826]],"cardinality":100,"criterion":[{"value":{"expression":"iuref","iu":"v5"},"descending":true,"nullFirst":true},{"value":{"expression":"iuref","iu":"v4"},"descending":false,"nullFirst":false}],"limit":100,"input":{"operator":"groupby","operatorId":3,"sqlpos":[[654,759],[239,254]],"cardinality":203.17,"input":{"operator":"join","operatorId":4,"cardinality":225.745,"method":"hash","referencedByScanEarlyProbe":true,"left":{"operator":"join","operatorId":5,"cardinality":50.5164,"method":"hash","referencedByScanEarlyProbe":true,"left":{"operator":"rightsemijoin","operatorId":6,"cardinality":50.5164,"method":"hash","singleMatch":true,"referencedByScanEarlyProbe":true,"left":{"operator":"select","operatorId":7,"cardinality":64,"input":{"operator":"groupby","operatorId":8,"sqlpos":[[469,512],[552,567]],"cardinality":128,"input":{"operator":"tablescan","operatorId":9,"sqlpos":[[444,452]],"cardinality":572,"relationId":7,"schema":{"type":"sessionschema"},"values":[{"name":"l_orderkey","type":["Integer"],"iu":["v7",["Integer"]]},{"name":"l_partkey","type":["Integer"],"iu":null},{"name":"l_suppkey","type":["Integer"],"iu":null},{"name":"l_linenumber","type":["Integer"],"iu":null},{"name":"l_quantity","type":["Numeric",12,2],"iu":["v8",["Numeric",12,2]]},{"name":"l_extendedprice","type":["Numeric",12,2],"iu":null},{"name":"l_discount","type":["Numeric",12,2],"iu":null},{"name":"l_tax","type":["Numeric",12,2],"iu":null},{"name":"l_returnflag","type":["Char1"],"iu":null},{"name":"l_linestatus","type":["Char1"],"iu":null},{"name":"l_shipdate","type":["Date"],"iu":null},{"name":"l_commitdate","type":["Date"],"iu":null},{"name":"l_receiptdate","type":["Date"],"iu":null},{"name":"l_shipinstruct","type":["Char",25],"iu":null},{"name":"l_shipmode","type":["Char",10],"iu":null},{"name":"l_comment","type":["Varchar",44],"iu":null}],"debugName":{"classification":"nonsensitive","value":"lineitem"},"selectivity":1},"keyExpressions":[{"expression":{"value":{"expression":"iuref","iu":"v7"}},"iu":["v9",["Integer"]]}],"groupingSets":[{"keyIndices":[0],"coreIndices":[0],"behavior":"regular"}],"emptyGroups":false,"aggExpressions":[{"value":{"expression":"iuref","iu":"v8"}}],"aggregates":[{"source":0,"operation":{"aggregate":"sum"},"iu":["v10",["BigNumeric",38,2]]}]},"condition":{"expression":"comparison","mode":"&gt;","left":{"expression":"iuref","iu":"v10"},"right":{"expression":"const","value":{"type":["BigNumeric",38,2],"low":30000,"high":0}}}},"right":{"operator":"tablescan","operatorId":10,"sqlpos":[[286,292]],"cardinality":128,"relationId":6,"schema":{"type":"sessionschema"},"values":[{"name":"o_orderkey","type":["Integer"],"iu":["v11",["Integer"]]},{"name":"o_custkey","type":["Integer"],"iu":["v12",["Integer"]]},{"name":"o_orderstatus","type":["Char1"],"iu":null},{"name":"o_totalprice","type":["Numeric",12,2],"iu":["v13",["Numeric",12,2]]},{"name":"o_orderdate","type":["Date"],"iu":["v14",["Date"]]},{"name":"o_orderpriority","type":["Char",15],"iu":null},{"name":"o_clerk","type":["Char",15],"iu":null},{"name":"o_shippriority","type":["Integer"],"iu":null},{"name":"o_comment","type":["Varchar",79],"iu":null}],"debugName":{"classification":"nonsensitive","value":"orders"},"earlyProbes":[{"builder":6,"attributes":[0],"type":"lookup","passOnNulls":false}],"selectivity":1},"condition":{"expression":"comparison","mode":"=","left":{"expression":"iuref","iu":"v11"},"right":{"expression":"iuref","iu":"v9"}}},"right":{"operator":"tablescan","operatorId":11,"sqlpos":[[268,276]],"cardinality":129,"relationId":5,"schema":{"type":"sessionschema"},"values":[{"name":"c_custkey","type":["Integer"],"iu":["v15",["Integer"]]},{"name":"c_name","type":["Varchar",25],"iu":["v16",["Varchar",25]]},{"name":"c_address","type":["Varchar",40],"iu":null},{"name":"c_nationkey","type":["Integer"],"iu":null},{"name":"c_phone","type":["Char",15],"iu":null},{"name":"c_acctbal","type":["Numeric",12,2],"iu":null},{"name":"c_mktsegment","type":["Char",10],"iu":null},{"name":"c_comment","type":["Varchar",117],"iu":null}],"debugName":{"classification":"nonsensitive","value":"customer"},"earlyProbes":[{"builder":5,"attributes":[0],"type":"lookup","passOnNulls":false}],"selectivity":1},"condition":{"expression":"comparison","mode":"=","left":{"expression":"iuref","iu":"v15"},"right":{"expression":"iuref","iu":"v12"}}},"right":{"operator":"tablescan","operatorId":12,"sqlpos":[[302,310]],"cardinality":572,"relationId":7,"schema":{"type":"sessionschema"},"values":[{"name":"l_orderkey","type":["Integer"],"iu":["v17",["Integer"]]},{"name":"l_partkey","type":["Integer"],"iu":null},{"name":"l_suppkey","type":["Integer"],"iu":null},{"name":"l_linenumber","type":["Integer"],"iu":null},{"name":"l_quantity","type":["Numeric",12,2],"iu":["v18",["Numeric",12,2]]},{"name":"l_extendedprice","type":["Numeric",12,2],"iu":null},{"name":"l_discount","type":["Numeric",12,2],"iu":null},{"name":"l_tax","type":["Numeric",12,2],"iu":null},{"name":"l_returnflag","type":["Char1"],"iu":null},{"name":"l_linestatus","type":["Char1"],"iu":null},{"name":"l_shipdate","type":["Date"],"iu":null},{"name":"l_commitdate","type":["Date"],"iu":null},{"name":"l_receiptdate","type":["Date"],"iu":null},{"name":"l_shipinstruct","type":["Char",25],"iu":null},{"name":"l_shipmode","type":["Char",10],"iu":null},{"name":"l_comment","type":["Varchar",44],"iu":null}],"debugName":{"classification":"nonsensitive","value":"lineitem"},"earlyProbes":[{"builder":4,"attributes":[0],"type":"lookup","passOnNulls":false}],"selectivity":1},"condition":{"expression":"comparison","mode":"=","left":{"expression":"iuref","iu":"v11"},"right":{"expression":"iuref","iu":"v17"}}},"keyExpressions":[{"expression":{"value":{"expression":"iuref","iu":"v16"}},"iu":["v",["Varchar",25]]},{"expression":{"value":{"expression":"iuref","iu":"v15"}},"iu":["v2",["Integer"]]},{"expression":{"value":{"expression":"iuref","iu":"v11"}},"iu":["v3",["Integer"]]},{"expression":{"value":{"expression":"iuref","iu":"v14"}},"iu":["v4",["Date"]]},{"expression":{"value":{"expression":"iuref","iu":"v13"}},"iu":["v5",["Numeric",12,2]]}],"groupingSets":[{"keyIndices":[0,1,2,3,4],"coreIndices":[0,1,2,3,4],"behavior":"regular"}],"emptyGroups":false,"aggExpressions":[{"value":{"expression":"iuref","iu":"v18"}}],"aggregates":[{"source":0,"operation":{"aggregate":"sum"},"iu":["v6",["BigNumeric",38,2]]}]}}})HYPERPLAN";

    buffers::view::PlanLayoutConfig config;
    config.mutate_level_height(20.0);
    config.mutate_node_height(8.0);
    config.mutate_node_padding_left(2.0);
    config.mutate_node_padding_right(2.0);
    config.mutate_max_label_chars(20);
    config.mutate_width_per_label_char(2.0);
    config.mutate_node_min_width(8);

    PlanViewModel model;
    model.Configure(config);
    model.ParseHyperPlan(std::string{plan});  // throws on error
    model.ComputeLayout();
}

TEST(HyperPlanTest, TPCHQ22) {
    std::string_view plan =
        R"HYPERPLAN({"operator":"executiontarget","operatorId":1,"cardinality":6.26608,"producesRows":true,"output":[{"expression":"iuref","iu":["v",["Varchar"]]},{"expression":"iuref","iu":["v2",["BigInt"]]},{"expression":"iuref","iu":["v3",["BigNumeric",38,2]]}],"outputNames":["cntrycode","numcust","totacctbal"],"input":{"operator":"sort","operatorId":2,"sqlpos":[[1481,1490]],"cardinality":6.26608,"criterion":[{"value":{"expression":"iuref","iu":"v"},"descending":false,"nullFirst":false}],"input":{"operator":"groupby","operatorId":3,"sqlpos":[[1437,1463],[160,168],[189,203]],"cardinality":6.26608,"input":{"operator":"map","operatorId":4,"sqlpos":[[280,324]],"cardinality":6.96232,"input":{"operator":"join","operatorId":5,"cardinality":6.96232,"method":"hash","singleMatch":true,"left":{"operator":"groupby","operatorId":6,"sqlpos":[[691,705]],"cardinality":1,"input":{"operator":"tablescan","operatorId":7,"sqlpos":[[783,791]],"cardinality":37,"relationId":5,"schema":{"type":"sessionschema"},"values":[{"name":"c_custkey","type":["Integer"],"iu":null},{"name":"c_name","type":["Varchar",25],"iu":null},{"name":"c_address","type":["Varchar",40],"iu":null},{"name":"c_nationkey","type":["Integer"],"iu":null},{"name":"c_phone","type":["Char",15],"iu":["v4",["Char",15]]},{"name":"c_acctbal","type":["Numeric",12,2],"iu":["v5",["Numeric",12,2]]},{"name":"c_mktsegment","type":["Char",10],"iu":null},{"name":"c_comment","type":["Varchar",117],"iu":null}],"debugName":{"classification":"nonsensitive","value":"customer"},"filters":[{"attribute":5,"mode":"&gt;","value":{"expression":"const","value":{"type":["Numeric",12,2],"value":0}}},{"attribute":4,"mode":"lambda","expression":{"expression":"lookup","input":[{"expression":"substring","arguments":[{"expression":"iuref","iu":"v4"},{"expression":"const","value":{"type":["Integer"],"value":1}},{"expression":"const","value":{"type":["Integer"],"value":2}}]}],"values":[{"type":["Varchar"],"value":"13"},{"type":["Varchar"],"value":"17"},{"type":["Varchar"],"value":"18"},{"type":["Varchar"],"value":"23"},{"type":["Varchar"],"value":"29"},{"type":["Varchar"],"value":"30"},{"type":["Varchar"],"value":"31"}],"collates":[null],"modes":["equals"]}}],"selectivity":0.286822},"groupingSets":[{"keyIndices":[],"coreIndices":null,"behavior":"static"}],"emptyGroups":true,"aggExpressions":[{"value":{"expression":"iuref","iu":"v5"}}],"aggregates":[{"source":0,"operation":{"aggregate":"avg"},"iu":["v6",["Numeric",16,6,"nullable"]]}]},"right":{"operator":"leftantijoin","operatorId":8,"cardinality":13.9246,"method":"hash","referencedByScanEarlyProbe":true,"left":{"operator":"tablescan","operatorId":9,"sqlpos":[[405,413]],"cardinality":38,"relationId":5,"schema":{"type":"sessionschema"},"values":[{"name":"c_custkey","type":["Integer"],"iu":["v7",["Integer"]]},{"name":"c_name","type":["Varchar",25],"iu":null},{"name":"c_address","type":["Varchar",40],"iu":null},{"name":"c_nationkey","type":["Integer"],"iu":null},{"name":"c_phone","type":["Char",15],"iu":["v8",["Char",15]]},{"name":"c_acctbal","type":["Numeric",12,2],"iu":["v9",["Numeric",12,2]]},{"name":"c_mktsegment","type":["Char",10],"iu":null},{"name":"c_comment","type":["Varchar",117],"iu":null}],"debugName":{"classification":"nonsensitive","value":"customer"},"filters":[{"attribute":4,"mode":"lambda","expression":{"expression":"lookup","input":[{"expression":"substring","arguments":[{"expression":"iuref","iu":"v8"},{"expression":"const","value":{"type":["Integer"],"value":1}},{"expression":"const","value":{"type":["Integer"],"value":2}}]}],"values":[{"type":["Varchar"],"value":"13"},{"type":["Varchar"],"value":"17"},{"type":["Varchar"],"value":"18"},{"type":["Varchar"],"value":"23"},{"type":["Varchar"],"value":"29"},{"type":["Varchar"],"value":"30"},{"type":["Varchar"],"value":"31"}],"collates":[null],"modes":["equals"]}}],"selectivity":0.294574},"right":{"operator":"tablescan","operatorId":10,"sqlpos":[[1282,1288]],"cardinality":128,"relationId":6,"schema":{"type":"sessionschema"},"mightScanDomain":true,"values":[{"name":"o_orderkey","type":["Integer"],"iu":null},{"name":"o_custkey","type":["Integer"],"iu":["v10",["Integer"]]},{"name":"o_orderstatus","type":["Char1"],"iu":null},{"name":"o_totalprice","type":["Numeric",12,2],"iu":null},{"name":"o_orderdate","type":["Date"],"iu":null},{"name":"o_orderpriority","type":["Char",15],"iu":null},{"name":"o_clerk","type":["Char",15],"iu":null},{"name":"o_shippriority","type":["Integer"],"iu":null},{"name":"o_comment","type":["Varchar",79],"iu":null}],"debugName":{"classification":"nonsensitive","value":"orders"},"earlyProbes":[{"builder":8,"attributes":[1],"type":"lookup","passOnNulls":false}],"selectivity":1},"condition":{"expression":"comparison","mode":"=","left":{"expression":"iuref","iu":"v10"},"right":{"expression":"iuref","iu":"v7"}}},"condition":{"expression":"comparison","mode":"&gt;","left":{"expression":"iuref","iu":"v9"},"right":{"expression":"iuref","iu":"v6"}}},"values":[{"iu":["v11",["Varchar"]],"value":{"expression":"substring","arguments":[{"expression":"iuref","iu":"v8"},{"expression":"const","value":{"type":["Integer"],"value":1}},{"expression":"const","value":{"type":["Integer"],"value":2}}]}}]},"keyExpressions":[{"expression":{"value":{"expression":"iuref","iu":"v11"}},"iu":["v",["Varchar"]]}],"groupingSets":[{"keyIndices":[0],"coreIndices":[0],"behavior":"regular"}],"emptyGroups":false,"aggExpressions":[{"value":{"expression":"iuref","iu":"v9"}}],"aggregates":[{"source":0,"operation":{"aggregate":"sum"},"iu":["v3",["BigNumeric",38,2]]},{"source":4294967295,"operation":{"aggregate":"count"},"iu":["v2",["BigInt"]]}]}}})HYPERPLAN";

    buffers::view::PlanLayoutConfig config;
    config.mutate_level_height(20.0);
    config.mutate_node_height(8.0);
    config.mutate_node_padding_left(2.0);
    config.mutate_node_padding_right(2.0);
    config.mutate_max_label_chars(20);
    config.mutate_width_per_label_char(2.0);
    config.mutate_node_min_width(8);

    PlanViewModel model;
    model.Configure(config);
    model.ParseHyperPlan(std::string{plan});  // throws on error
    model.ComputeLayout();
}

}  // namespace
