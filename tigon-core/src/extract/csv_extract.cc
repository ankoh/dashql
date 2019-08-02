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
    auto *str = reinterpret_cast<unsigned char *>(buffer.data());
    auto strLen = buffer.size() * sizeof(unsigned char *) / sizeof(std::byte);

    // Parse the buffer
    auto parser = csv::make_parser(str, strLen);
    for (auto &&row : parser) {
        for (auto &&cell : row) {
        }
    }
}
