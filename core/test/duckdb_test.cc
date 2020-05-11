//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/tools/web/web_api.h"
#include "tigon/proto/engine.pb.h"
#include <gtest/gtest.h>
#include <numeric>
#include <sstream>

using namespace tigon;
using namespace std;

namespace {

TEST(WebAPITest, ExplainQuery) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Session session{db};

    session.runQuery(R"RAW(
        CREATE TABLE r1(
            a int,
            b int
        );
        CREATE TABLE r2(
            c int,
            d int
        );
        CREATE TABLE r3(
            e int,
            f int
        );
    )RAW");
    session.runQuery(R"RAW(
        INSERT INTO r1 VALUES
            (1, 2),
            (3, 4),
            (5, 6);

        INSERT INTO r2 VALUES
            (1, 2),
            (3, 4),
            (5, 6);
        INSERT INTO r3 VALUES
            (1, 2),
            (3, 4),
            (5, 6);
    )RAW");

    {
        session.planQuery("SELECT 1;");

        auto& response = session.getResponse();
        auto responseData = response.getData();
        ASSERT_EQ(response.getStatus(), proto::web_api::StatusCode::SUCCESS);

        // Get the query plan
        google::protobuf::Arena arena;
        auto* queryPlan = google::protobuf::Arena::CreateMessage<proto::engine::QueryPlan>(&arena);
        ASSERT_TRUE(queryPlan->ParseFromArray(responseData.data(), responseData.size()));

        // Inspect the plan
        auto& opTypes = queryPlan->operator_types();
        auto& opChildOffsets = queryPlan->operator_child_offsets();
        auto& opChildren = queryPlan->operator_children();
        ASSERT_EQ(opTypes.size(), 2)
            << std::accumulate(opTypes.begin(), opTypes.end(), string{}, [](auto& prev, uint8_t type) {
                return string{prev.empty() ? "" : prev + ","} + proto::engine::LogicalOperatorType_Name(type);
            });
        ASSERT_EQ(opTypes.Get(0), proto::engine::LogicalOperatorType::OP_PROJECTION);
        ASSERT_EQ(opTypes.Get(1), proto::engine::LogicalOperatorType::OP_GET);
        ASSERT_EQ(opChildOffsets.size(), 2);
        ASSERT_EQ(opChildOffsets.Get(0), 0);
        ASSERT_EQ(opChildOffsets.Get(1), 1);
        ASSERT_EQ(opChildren.size(), 1);
        ASSERT_EQ(opChildren.Get(0), 1);
    }

    {
        session.planQuery(R"RAW(
            SELECT *
            FROM r1, r2
            WHERE a = c;
        )RAW");

        auto& response = session.getResponse();
        auto responseData = response.getData();
        ASSERT_EQ(response.getStatus(), proto::web_api::StatusCode::SUCCESS);

        // Get the query plan
        google::protobuf::Arena arena;
        auto* queryPlan = google::protobuf::Arena::CreateMessage<proto::engine::QueryPlan>(&arena);
        ASSERT_TRUE(queryPlan->ParseFromArray(responseData.data(), responseData.size()));

        // Inspect the plan
        auto& opTypes = queryPlan->operator_types();
        auto& opChildOffsets = queryPlan->operator_child_offsets();
        auto& opChildren = queryPlan->operator_children();
        ASSERT_EQ(opTypes.size(), 5)
            << accumulate(opTypes.begin(), opTypes.end(), string{}, [](auto& prev, uint8_t type) {
                return string{prev.empty() ? "" : prev + ","} + proto::engine::LogicalOperatorType_Name(type);
            });
        ASSERT_EQ(opTypes.Get(0), proto::engine::LogicalOperatorType::OP_PROJECTION);
        ASSERT_EQ(opTypes.Get(1), proto::engine::LogicalOperatorType::OP_FILTER);
        ASSERT_EQ(opTypes.Get(2), proto::engine::LogicalOperatorType::OP_CROSS_PRODUCT);
        ASSERT_EQ(opTypes.Get(3), proto::engine::LogicalOperatorType::OP_GET);
        ASSERT_EQ(opTypes.Get(4), proto::engine::LogicalOperatorType::OP_GET);
        ASSERT_EQ(opChildOffsets.size(), 5);
        ASSERT_EQ(opChildOffsets.Get(0), 0);
        ASSERT_EQ(opChildOffsets.Get(1), 1);
        ASSERT_EQ(opChildOffsets.Get(2), 2);
        ASSERT_EQ(opChildOffsets.Get(3), 4);
        ASSERT_EQ(opChildOffsets.Get(4), 4);
        ASSERT_EQ(opChildren.size(), 4);
        ASSERT_EQ(opChildren.Get(0), 1);
        ASSERT_EQ(opChildren.Get(1), 2);
        ASSERT_EQ(opChildren.Get(2), 3);
        ASSERT_EQ(opChildren.Get(3), 4);
    }
}

}
