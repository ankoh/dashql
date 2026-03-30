#include "duckdb/web/webdb.h"

// Force initialization of WebDB singleton and static objects
int main() {
    // Initialize the WebDB singleton - this triggers construction of the database
    // and ensures all static initializers have run
    auto maybe_webdb = duckdb::web::WebDB::Get();
    if (!maybe_webdb.ok()) {
        return 1;
    }
    return 0;
}
