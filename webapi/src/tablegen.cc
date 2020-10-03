// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/tablegen.h"
#include "duckdb/main/appender.hpp"
#include <tuple>
#include <random>
#include <variant>

namespace duckdb_webapi {

namespace {

/// Generic data type
using data_t = uint64_t;
static_assert(sizeof(int64_t) <= sizeof(data_t));
static_assert(sizeof(double) <= sizeof(data_t));

/// Return value as data
template<typename T>
data_t asData(const T& v) {
    return *reinterpret_cast<const data_t*>(&v);
}
enum class DataType { Integer, Float };

/// A generator expression
struct GeneratorExpression {
    /// Destructor
    virtual ~GeneratorExpression() = default;
    /// Get the data type
    virtual DataType getType() = 0;
    /// Generate a value
    virtual data_t generate() = 0;
};

/// A constant integer
struct ConstantInt : public GeneratorExpression {
    /// The constant value
    int64_t value;
    /// Constructor
    ConstantInt(int64_t value)
        : value(value) {}
    /// Get the data type
    DataType getType() override { return DataType::Integer; }
    /// Generate a value
    data_t generate() override { return asData(value); }
};

/// A constant floating point value
struct ConstantFloat : public GeneratorExpression {
    /// The constant value
    double value;
    /// Constructor
    ConstantFloat(double value)
        : value(value) {}
    /// Get the data type
    DataType getType() override { return DataType::Float; }
    /// Generate a value
    data_t generate() override { return asData(value); }
};

/// A column ref
struct ColumnRef : public GeneratorExpression {
    /// The column type
    DataType columnType;
    /// The other columns
    const std::vector<data_t>& columns;
    /// The column index
    size_t columnIndex;

    /// Constructor
    ColumnRef(DataType colType, const std::vector<data_t>& cols, size_t colIdx)
        : columnType(colType), columns(cols), columnIndex(colIdx) {}
    /// Get the data type
    DataType getType() override { return columnType; }
    /// Generate a value
    data_t generate() override { return columns[columnIndex]; }
};

/// A generic distribution generator
template <typename D>
struct GenericDistribution : public GeneratorExpression {
    /// The generator
    std::mt19937& generator;
    /// The distribution
    D distribution;
    /// Constructor
    GenericDistribution(std::mt19937& gen, D&& dist)
        : generator(gen), distribution(move(dist)) {}
    /// Generate a value
    data_t generate() override { return asData(distribution(generator)); }
};

/// A higher order distribution generator
template <template <typename> class D, typename T>
struct HigherOrderDistribution : public GeneratorExpression {
    /// The generator
    std::mt19937& generator;
    /// The distribution
    D<T> distribution;
    /// Constructor
    HigherOrderDistribution(std::mt19937& gen, D<T>&& dist)
        : generator(gen), distribution(move(dist)) {}
    /// Get the type
    DataType getType() override {
        if constexpr (std::is_same_v<T, int64_t>)
            return DataType::Integer;
        return DataType::Float;
    }
    /// Generate a value
    data_t generate() override { return asData(distribution(generator)); }
};

using UniformIntDistribution = HigherOrderDistribution<std::uniform_int_distribution, int64_t>;
using UniformFloatDistribution = HigherOrderDistribution<std::uniform_real_distribution, double>;
using BernoulliDistribution = GenericDistribution<std::bernoulli_distribution>;
using BinomialDistribution = HigherOrderDistribution<std::binomial_distribution, int64_t>;
using GeometricDistribution = HigherOrderDistribution<std::geometric_distribution, int64_t>;
using NegativeBinomialDistribution = HigherOrderDistribution<std::negative_binomial_distribution, int64_t>;
using PoissonDistribution = HigherOrderDistribution<std::poisson_distribution, int64_t>;
using ExponentialDistribution = HigherOrderDistribution<std::exponential_distribution, double>;
using GammaDistribution = HigherOrderDistribution<std::gamma_distribution, double>;
using ExtremeValueDistribution = HigherOrderDistribution<std::extreme_value_distribution, double>;
using NormalDistribution = HigherOrderDistribution<std::normal_distribution, double>;
using LogNormalDistribution = HigherOrderDistribution<std::lognormal_distribution, double>;
using ChiSquaredDistribution = HigherOrderDistribution<std::chi_squared_distribution, double>;
using CauchyDistribution = HigherOrderDistribution<std::cauchy_distribution, double>;
using FisherFDistribution = HigherOrderDistribution<std::fisher_f_distribution, double>;
using StudentTDistribution = HigherOrderDistribution<std::student_t_distribution, double>;
using DiscreteDistribution = HigherOrderDistribution<std::discrete_distribution, double>;
using PiecewiseConstantDistribution = HigherOrderDistribution<std::piecewise_constant_distribution, double>;
using PiecewiseLinearDistribution = HigherOrderDistribution<std::piecewise_linear_distribution, double>;

/// A binary expression
struct BinaryGeneratorExpression: public GeneratorExpression {
    /// The input expressions
    std::unique_ptr<GeneratorExpression> left, right;
    /// Constructor
    BinaryGeneratorExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : left(move(left)), right(move(right)) {}
};

}

// /// Generate table
// void generateTable(duckdb::Connection& conn, proto::TableSpec& spec) {
//     /// Get the column name
//     std::vector<std::pair<const char*, duckdb::LogicalType>> columns;
//     for (unsigned i = 0; i < spec.columns()->size(); ++i) {
//         auto col = spec.columns()->Get(i);
//         auto name = col->name()->c_str();
//         auto valueType = translate(*col->value_type());
//         columns.push_back({name, valueType});
//     }
// 
//     // Build CREATE TABLE statement
//     std::stringstream stmt{"CREATE TABLE "};
//     stmt << spec.name()->c_str();
//     stmt << " (";
//     bool first = true;
//     for (auto iter = columns.begin(); iter != columns.end(); ++iter, first = false) {
//         auto& [name, type] = *iter;
//         if (!first)
//             stmt << ", ";
//         stmt << name << std::endl;
//         stmt << type.ToString();
//     }
//     stmt << ")";
//     conn.Query(stmt.str());
// 
//     // Create value gernators
//     std::mt19937 rnd;
//     duckdb::Appender appender(conn, spec.name()->c_str());
//     std::vector<ValueGenerator> values;
//     for (unsigned i = 0; i < spec.columns()->size(); ++i)
//         values.emplace_back(rnd, appender, spec.columns()->Get(i));
// 
//     // Initialize the appender
//     for (unsigned row = 0; row < spec.rows(); ++row) {
//         appender.BeginRow();
//         for (auto& gen: values)
//             gen.append();
//         appender.EndRow();
//     }
// }

void generateTable(duckdb::Connection& conn, proto::TableSpecification& spec) {
    (void)conn;
    (void)spec;
}

}
