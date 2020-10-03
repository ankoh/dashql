// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/tablegen.h"
#include "duckdb/main/appender.hpp"
#include <tuple>
#include <random>
#include <variant>

namespace duckdb_webapi {

namespace {

static_assert(sizeof(double) <= sizeof(uint64_t));
using data_t = uint64_t;

template<typename T>
data_t asData(const T& v) {
    return *reinterpret_cast<const data_t*>(&v);
}

/// A generator expression
struct GeneratorExpression {
    /// Generate a value
    virtual data_t generate();
};

struct ConstantInt : public GeneratorExpression {
    uint64_t value;
    data_t generate() override {
        return asData(value);
    }
};

struct ConstantFloat : public GeneratorExpression {
    double value;
    data_t generate() override {
        return asData(value);
    }
};

struct ColumnRef : public GeneratorExpression {
};

/// A generic distribution generator
template <typename D>
struct GenericDistribution : public GeneratorExpression {
    std::mt19937& generator;
    D distribution;
    data_t generate() override {
        return asData(distribution(generator));
    }
};

/// A higher order distribution generator
template <template <typename> class D, typename T>
struct HigherOrderDistribution : public GeneratorExpression {
    std::mt19937& generator;
    D<T> distribution;
    data_t generate() override {
        return asData(distribution(generator));
    }
};

using UniformIntDistribution = HigherOrderDistribution<std::uniform_int_distribution, uint64_t>;
using UniformFloatDistribution = HigherOrderDistribution<std::uniform_real_distribution, double>;
using BernoulliDistribution = GenericDistribution<std::bernoulli_distribution>;
using BinomialDistribution = HigherOrderDistribution<std::binomial_distribution, uint64_t>;
using GeometricDistribution = HigherOrderDistribution<std::geometric_distribution, uint64_t>;
using NegativeBinomialDistribution = HigherOrderDistribution<std::negative_binomial_distribution, uint64_t>;
using PoissonDistribution = HigherOrderDistribution<std::poisson_distribution, uint64_t>;
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
