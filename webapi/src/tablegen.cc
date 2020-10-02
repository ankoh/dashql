// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/tablegen.h"
#include "duckdb/main/appender.hpp"
#include <tuple>

namespace duckdb_webapi {

namespace {

/// Translate a type
duckdb::LogicalType translateType(const proto::LogicalType& type) {
    switch (type.type_id()) {
        default:
            return duckdb::LogicalType();
    }
}

/// A distribution
struct Distribution {
};

/// A value generator
struct ValueGenerator {
    /// The appender
    duckdb::Appender& appender;
    /// The name
    const char* name;
    /// The value distribution
    std::unique_ptr<Distribution> valueDist;
    /// The null distribution
    std::unique_ptr<Distribution> nullDist;

    /// Constructor
    ValueGenerator(duckdb::Appender& appender, const char* name, std::unique_ptr<Distribution> valueDist, std::unique_ptr<Distribution> nullDist)
        : appender(appender), name(name), valueDist(move(valueDist)), nullDist(move(nullDist)) {}
    /// Destructor
    virtual ~ValueGenerator() = default;
    /// Append value
    virtual void append() = 0;
};

/// An integer generator
struct IntegerGenerator: public ValueGenerator {
    IntegerGenerator(const char* name, std::unique_ptr<Distribution> valueDist, std::unique_ptr<Distribution> nullDist, duckdb::Appender& appender)
        : ValueGenerator(appender, name, move(valueDist), move(nullDist)) {}
};

}

/// Generate table
void generateTable(duckdb::Connection& conn, proto::TableSpec& spec) {
    /// Get the column name
    std::vector<std::pair<const char*, duckdb::LogicalType>> columns;
    for (unsigned i = 0; i < spec.columns()->size(); ++i) {
        auto col = spec.columns()->Get(i);
        auto name = col->name()->c_str();
        auto& type = *col->value_type();
        auto valueType = translateType(type);
        columns.push_back({name, valueType});
    }

    // Build CREATE TABLE statement
    std::stringstream stmt{"CREATE TABLE "};
    stmt << spec.name()->c_str();
    stmt << " (";
    bool first = true;
    for (auto iter = columns.begin(); iter != columns.end(); ++iter, first = false) {
        auto& [name, type] = *iter;
        if (!first)
            stmt << ", ";
        stmt << name << std::endl;
        stmt << type.ToString();
    }
    stmt << ")";
    conn.Query(stmt.str());

    // Create values
    duckdb::Appender appender(conn, spec.name()->c_str());
    std::vector<std::unique_ptr<ValueGenerator>> values;
    for (unsigned i = 0; i < spec.columns()->size(); ++i) {
        auto col = spec.columns()->Get(i);
        auto name = col->name()->c_str();
        auto valueType = col->value_type();
        auto valueDist = col->value_distribution();
        auto nullDist = col->null_distribution();
        switch (valueType->type_id()) {
            case proto::LogicalTypeID::INTEGER:
                break;
            default:
                break;
        }
    }

    // Initialize the appender
    for (unsigned row = 0; row < spec.rows(); ++row) {
        appender.BeginRow();
        for (auto& gen: values)
            gen->append();
        appender.EndRow();
    }
}

}
