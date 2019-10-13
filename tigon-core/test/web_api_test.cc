//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/tools/web/web_api.h"
#include "tigon/proto/web_api_generated.h"
#include <gtest/gtest.h>
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
        ASSERT_EQ(session.getResponseStatus(), proto::StatusCode::Success);

        // Get the query plan
        auto* responseBuffer = session.getResponseData();
        auto* responseData = responseBuffer->getData();
        auto* queryPlan = flatbuffers::GetRoot<proto::QueryPlan>(responseData);
        ASSERT_NE(responseBuffer, nullptr);
        ASSERT_NE(responseData, nullptr);
        ASSERT_NE(queryPlan, nullptr);

        // Inspect the plan
        auto* opTypes = queryPlan->operator_types();
        auto* opChildOffsets = queryPlan->operator_child_offsets();
        auto* opChildren = queryPlan->operator_children();
        ASSERT_EQ(opTypes->size(), 2)
            << accumulate(opTypes->begin(), opTypes->end(), string{}, [](auto& prev, uint8_t type) {
                return string{prev.empty() ? "" : prev + ","} +
                    proto::EnumNameLogicalOperatorType(static_cast<proto::LogicalOperatorType>(type));
            });
        ASSERT_EQ(opTypes->GetEnum<proto::LogicalOperatorType>(0), proto::LogicalOperatorType::PROJECTION);
        ASSERT_EQ(opTypes->GetEnum<proto::LogicalOperatorType>(1), proto::LogicalOperatorType::GET);
        ASSERT_EQ(opChildOffsets->size(), 2);
        ASSERT_EQ(opChildOffsets->Get(0), 0);
        ASSERT_EQ(opChildOffsets->Get(1), 1);
        ASSERT_EQ(opChildren->size(), 0);
    }

    {
        session.planQuery(R"RAW(
            SELECT *
            FROM r1, r2
            WHERE a = c;
        )RAW");
        ASSERT_EQ(session.getResponseStatus(), proto::StatusCode::Success);
    }
}

}
