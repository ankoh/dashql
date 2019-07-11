#include <cstdio>
#include "duckdb.hpp"
#include "tigon/proto/web_api_generated.h"

std::unique_ptr<duckdb::DuckDB> db;

extern "C" {

void tigon_db_query(char* str);

void run_query(char* text) {
    duckdb::Connection conn{*db};
    auto result = conn.Query(text);
    auto result_str = result->ToString();
    printf("%s\n", result_str.c_str());
}

}

int main() {
    db = std::make_unique<duckdb::DuckDB>(nullptr);
    printf("tigon core loaded\n");
    return 0;
}

