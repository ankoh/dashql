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

#include "dashql/common/blob_stream.h"
#include "dashql/program_instance.h"
#include "dashql/proto_generated.h"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/web/common/expected.h"
#include "duckdb/web/common/raw_buffer.h"
#include "duckdb/web/webdb.h"

namespace dashql {

template <typename T> using ExpectedBufferRef = duckdb::web::ExpectedBufferRef<T>;
using ActionGraph = proto::action::ActionGraph;
using Plan = proto::session::Plan;
using Program = proto::syntax::Program;
using RawBuffer = duckdb::web::RawBuffer;

namespace fb = flatbuffers;

class Session {
   protected:
    /// The database
    duckdb::web::WebDB database_;
    /// The connection (if any)
    duckdb::web::WebDB::Connection* database_connection_;

    /// The volatile program text (if any)
    std::shared_ptr<std::string> volatile_program_text_;
    /// The volatile program text (if any)
    std::shared_ptr<proto::syntax::ProgramT> volatile_program_;

    /// The planned program (if any)
    std::unique_ptr<ProgramInstance> planned_program_;
    /// The planned graph (if any)
    std::unique_ptr<proto::action::ActionGraphT> planned_graph_;
    /// The planner log
    std::vector<std::unique_ptr<ProgramInstance>> planner_log_;
    /// The planner log writer cursor
    size_t planner_log_writer_;

    /// Extract csv
    Signal ExtractCSV(BlobStreamBuffer& blob_streambuf, duckdb::BufferedCSVReaderOptions csv_options, std::vector<duckdb::LogicalType>&& csv_col_types, const std::string& schema_name, const std::string& table_name);

   public:
    /// Constructor
    Session();

    /// Access the database
    auto* AccessDatabase() { return database_connection_; }
    /// Parse a program
    ExpectedBuffer<proto::syntax::Program> ParseProgram(std::string_view text);
    /// Plan the last program
    ExpectedBuffer<proto::session::Plan> PlanProgram();

    void UpdateParameter();
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_INTERPRETER_H_
