#include <stdio.h>
#include "duckdb.hpp"
#include "proto/core_db_generated.h"

std::unique_ptr<duckdb::DuckDB> db;

extern "C" {

void run_query(char* text) {
    duckdb::Connection conn{*db};
    auto result = conn.Query(text);
    auto result_str = result->ToString();
    printf("%s\n", result_str.c_str());
}

}

int main() {
    db = std::make_unique<duckdb::DuckDB>(nullptr);
    printf("initialized database!\n");
    return 0;
}

