//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/extract/csv_extract.h"
#include "cwcsv/parser.h"

using namespace tigon;

// Constructor
CSVExtract::CSVExtract(duckdb::Connection &conn, proto::TQLExtractStatement &statement) : Extract(conn, statement) {}

// Prepare the csv extract
void CSVExtract::prepare() {
    auto *method = statement.extract_method_as<proto::TQLCSVExtract>();
    auto *columns = method->columns();
}

// Read the csv extract
void CSVExtract::read(nonstd::span<std::byte> buffer) {
    auto *method = statement.extract_method_as<proto::TQLCSVExtract>();
    auto *columns = method->columns();

    // Cast the buffer
    static_assert(sizeof(char) == sizeof(std::byte));
    auto *str = reinterpret_cast<char*>(buffer.data());

    // Parse the buffer
    auto parser = csv::make_parser(str, buffer.size());
    for (auto &&row : parser) {
        for (auto &&cell : row) {
            // TODO: Do we really need to assemble a INSERT INTO .. VALUES .. statement here?
            //       Phew I'd love a bulk import for sure...
        }
    }
}
