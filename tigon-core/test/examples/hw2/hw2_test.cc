//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "arrow/api.h"
#include "arrow/buffer.h"
#include "arrow/io/api.h"
#include "arrow/io/memory.h"
#include "arrow/memory_pool.h"
#include "gtest/gtest.h"
#include "parquet/arrow/reader.h"
#include "parquet/arrow/writer.h"
#include "parquet/arrow/schema.h"
#include "parquet/exception.h"
#include "rapidjson/rapidjson.h"

using ParquetType = parquet::Type;
using parquet::Repetition;
using parquet::schema::GroupNode;
using parquet::schema::PrimitiveNode;
using parquet::schema::Node;

namespace {

TEST(HW2Test, MatchResultToParquet) {

    std::vector<std::shared_ptr<Node>> fields {
        PrimitiveNode::Make("MatchID", Repetition::REQUIRED, ParquetType::BYTE_ARRAY),
        PrimitiveNode::Make("MatchType", Repetition::REQUIRED, ParquetType::INT32),
        PrimitiveNode::Make("GameMode", Repetition::REQUIRED, ParquetType::INT32),
        PrimitiveNode::Make("PlaylistID", Repetition::REQUIRED, ParquetType::BYTE_ARRAY),
        PrimitiveNode::Make("MapID", Repetition::REQUIRED, ParquetType::BYTE_ARRAY),
        PrimitiveNode::Make("IsMatchComplete", Repetition::REQUIRED, ParquetType::BOOLEAN),
        PrimitiveNode::Make("MatchEndReason", Repetition::REQUIRED, ParquetType::INT32),
        PrimitiveNode::Make("VictoryCondition", Repetition::REQUIRED, ParquetType::INT32),
        PrimitiveNode::Make("MatchStartDate", Repetition::REQUIRED, ParquetType::INT64),
        PrimitiveNode::Make("MatchDuration", Repetition::REQUIRED, ParquetType::INT64),
        GroupNode::Make("Teams", Repetition::REPEATED, {
            PrimitiveNode::Make("TeamId", Repetition::REQUIRED, ParquetType::INT32),
            PrimitiveNode::Make("TeamSize", Repetition::REQUIRED, ParquetType::INT32),
            PrimitiveNode::Make("MatchOutcome", Repetition::REQUIRED, ParquetType::INT32),
            PrimitiveNode::Make("ObjectiveScore", Repetition::REQUIRED, ParquetType::INT32),
        }),
        GroupNode::Make("Players", Repetition::REPEATED, {
            PrimitiveNode::Make("IsHuman", Repetition::REQUIRED, ParquetType::BOOLEAN),
            PrimitiveNode::Make("Gamertag", Repetition::REQUIRED, ParquetType::BYTE_ARRAY),
            GroupNode::Make("UnitStats", Repetition::REQUIRED, {
                PrimitiveNode::Make("UnitType", Repetition::REQUIRED, ParquetType::BYTE_ARRAY),
                PrimitiveNode::Make("TotalBuilt", Repetition::REQUIRED, ParquetType::INT32),
                PrimitiveNode::Make("TotalLost", Repetition::REQUIRED, ParquetType::INT32),
                PrimitiveNode::Make("TotalDestroyed", Repetition::REQUIRED, ParquetType::INT32),
            })
        })
    };

    // TODO continue here if these issues make progress:
    //  https://issues.apache.org/jira/browse/ARROW-1644
    //  https://github.com/apache/parquet-cpp/pull/462
    //  https://github.com/apache/arrow/pull/4066

    // Right now, parquet does not support arrow schemas with list -> struct -> list.
    // Which is pretty essential in the case of HW2 at least.
}

}

