//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "main/client_context.hpp"
#include "parser/parser.hpp"
#include "planner/planner.hpp"
#include "duckdb.hpp"
#include <string_view>

using namespace std;

extern void parse_sql(duckdb::DuckDB& db, std::string_view text) {
    duckdb::Connection conn{db};

    // Parse the statements
    duckdb::Parser parser(*conn.context);
    parser.ParseQuery(string(text));
  
    // Get statements
    for (auto& statement: parser.statements) {
        duckdb::Planner planner{*conn.context};
    }
}
