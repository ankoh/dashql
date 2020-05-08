//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include <string_view>
#include "duckdb.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parser/parser.hpp"
#include "duckdb/planner/planner.hpp"

using namespace std;

extern void parse_sql(duckdb::DuckDB& db, std::string_view text) {
    duckdb::Connection conn{db};

    // Parse the statements
    duckdb::Parser parser;
    parser.ParseQuery(string(text));

    // Get statements
    for (auto& statement : parser.statements) {
        duckdb::Planner planner{*conn.context};
    }
}
