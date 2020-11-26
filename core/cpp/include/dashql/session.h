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

#include "dashql/proto/action_generated.h"
#include "dashql/proto/session_generated.h"
#include "duckdb/web/common/expected.h"
#include "duckdb/web/webdb.h"

namespace dashql {

using ActionGraph = proto::action::ActionGraph;
using Plan = proto::session::Plan;
template <typename T> using ExpectedBufferRef = duckdb::web::ExpectedBufferRef<T>;
using Program = proto::syntax::Program;

namespace fb = flatbuffers;

class Session {
   protected:
    /// The database
    duckdb::web::WebDB database_;
    /// The connection (if any)
    duckdb::web::WebDB::Connection* database_connection_;

    /// The current program text
    std::string program_text_;
    /// The plan
    std::pair<const proto::session::Plan*, fb::DetachedBuffer> plan_;
    /// The current action status
    std::unordered_map<uint32_t, proto::action::ActionStatus> action_status_;

   public:
    /// Constructor
    Session();

    /// Access the database
    auto* AccessDatabase() { return database_connection_; }
    /// Evaluate a program
    ExpectedBufferRef<proto::session::Plan> Evaluate(const char* text);
    /// Update the action status
    void UpdateActionStatus(uint32_t id, proto::action::ActionStatus status);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_INTERPRETER_H_
