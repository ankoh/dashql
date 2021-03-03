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

    struct ExecutionPlan {
        std::string entry_point;
    };

    std::vector<char> module;
    ExecutionPlan execution_plan;

    Dataframe(Dataframe::AlgebraTree& query);
};
}  // namespace dataframe
}  // namespace dashql

#endif  // INCLUDE_DASHQL_DATAFRAME_DATAFRAME_H_
