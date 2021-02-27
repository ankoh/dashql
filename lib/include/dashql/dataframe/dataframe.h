// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_DATAFRAME_DATAFRAME_H_
#define INCLUDE_DASHQL_DATAFRAME_DATAFRAME_H_

#include "dashql/common/expected.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace dataframe {
class Dataframe {
   public:
    class AlgebraTree {};

    Dataframe();

    ExpectedBuffer<proto::webdb::QueryResult> Query(Dataframe::AlgebraTree algebra_tree);

    void Write();

    void End();

    ExpectedBuffer<proto::webdb::QueryResultChunk> Next();
};
}  // namespace dataframe
}  // namespace dashql

#endif  // INCLUDE_DASHQL_DATAFRAME_DATAFRAME_H_
