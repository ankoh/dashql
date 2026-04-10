#include "dashql/view/plan_view_model.h"

#include <flatbuffers/flatbuffer_builder.h>

#include "dashql/buffers/index_generated.h"
#include "gtest/gtest.h"

using namespace dashql;

namespace {

TEST(SparkPlanTest, LinearPlan) {
    std::string_view plan = R"SPARKPLAN(
Execute CollectLimit 10
   +- Project [id#0]
      +- Filter (id#0 > 1)
         +- BatchScan default.t[id#0]
)SPARKPLAN";

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
    model.ParseSparkPlan(std::string{plan});  // throws on error
    model.ComputeLayout();

    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(model.Pack(fb));
    auto* vm = flatbuffers::GetRoot<buffers::view::PlanViewModel>(fb.GetBufferPointer());
    auto* strings = vm->string_dictionary();
    ASSERT_EQ(vm->operators()->size(), 4);
    ASSERT_EQ(vm->root_operators()->size(), 1);
    EXPECT_EQ(vm->root_operators()->Get(0), 3);
    EXPECT_EQ(strings->Get(vm->operators()->Get(0)->operator_type_name())->string_view(), "BatchScan");
    EXPECT_EQ(strings->Get(vm->operators()->Get(3)->operator_type_name())->string_view(), "Execute CollectLimit");
}

TEST(SparkPlanTest, NestedPlan) {
    std::string_view plan = R"SPARKPLAN(
Execute InsertIntoHadoopFsRelationCommand s3://bucket/path, false, Parquet, [path=s3://bucket/path], Overwrite, [Segment_Id__c]
   +- WriteFiles
      +- HashAggregate(keys=[entityId#7109], functions=[], output=[Segment_Id__c#7313], schema specialized)
         +- Project [cast(id__c#3894 as string) AS entityId#7109]
            +- Filter (exists#7777 OR exists#7778)
               +- BroadcastHashJoin [cast(id__c#3894 as string)], [IndividualId__c#5169], ExistenceJoin(exists#7778), BuildRight, false
                  :- SortMergeJoin [cast(id__c#3894 as string)], [SoldToCustomerId__c#4437], LeftSemi
                  :  +- BatchScan lakehouse.individual__dll[id__c#3894]
                  +- BroadcastExchange HashedRelationBroadcastMode(List(input[0, string, true]),false), [plan_id=947]
                     +- Project [individualid__c#2244 AS IndividualId__c#5169]
                        +- Filter (isnotnull(hasoptedoutprocessing__c#2245) AND NOT cast(hasoptedoutprocessing__c#2245 as boolean))
                           +- BatchScan lakehouse.individualgdprstate__dll[individualid__c#2244, hasoptedoutprocessing__c#2245]
)SPARKPLAN";

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
    model.ParseSparkPlan(std::string{plan});  // throws on error
    model.ComputeLayout();

    flatbuffers::FlatBufferBuilder fb;
    fb.Finish(model.Pack(fb));
    auto* vm = flatbuffers::GetRoot<buffers::view::PlanViewModel>(fb.GetBufferPointer());
    ASSERT_GT(vm->operators()->size(), 8);
    ASSERT_EQ(vm->root_operators()->size(), 1);
}

}  // namespace
