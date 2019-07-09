#include <stdio.h>
#include "duckdb.hpp"

int main() {
    duckdb::DuckDB db{nullptr};
    duckdb::Connection conn{db};

    conn.Query("CREATE TABLE foo(i INTEGER)");
    conn.Query("INSERT INTO foo VALUES (3)");
    auto result = conn.Query("SELECT * FROM foo");
    auto result_str = result->ToString();

    printf("hello, duckdb!\n");
    printf("%s\n", result_str.c_str());
    return 0;
}

