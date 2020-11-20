// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_SESSION_H_
#define INCLUDE_DASHQL_SESSION_H_

#include <iostream>
#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

#include "dashql/common/expected.h"
#include "dashql/proto/action_generated.h"
#include "dashql/proto/syntax_dashql_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "dashql/proto/syntax_sql_generated.h"
#include "duckdb/web/webdb.h"

namespace dashql {

namespace sx = proto::syntax;
namespace fb = flatbuffers;
namespace ac = proto::action;

class Session {
   protected:
    /// The database
    duckdb::web::WebDB database_;
    /// The connection (if any)
    duckdb::web::WebDB::Connection* database_connection_;

    /// The current program text
    std::string program_text_;
    /// The current program
    std::pair<sx::Program*, fb::DetachedBuffer> program_;
    /// The action graph
    std::pair<ac::ActionGraph*, fb::DetachedBuffer> action_graph_;
    /// The current action status
    std::unordered_map<uint32_t, ac::ActionStatus> action_status_;

   public:
    /// Constructor
    Session();

    /// Evaluate a program
    std::pair<sx::Program*, ac::ActionGraph*> Evaluate(std::string program_text);
    /// Update the action status
    void UpdateActionStatus(uint32_t id, ac::ActionStatus status);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_INTERPRETER_H_
