#ifndef DASHQL_CORE_TEST_ROPE_FUZZER_COMMON_H_
#define DASHQL_CORE_TEST_ROPE_FUZZER_COMMON_H_

#include <random>

#include "dashql/testing/rope_test_common.h"
#include "gtest/gtest.h"

using namespace dashql;
using namespace dashql::rope_test;

namespace {

struct RopeInteractionGenerator {
    enum class InteractionType : uint8_t { Insert, Remove };
    struct Interaction {
        InteractionType type;
        size_t begin;
        size_t count;

        void Apply(std::string& buffer, std::string_view data) {
            switch (type) {
                case InteractionType::Insert:
                    assert(begin <= buffer.size());
                    assert(count <= data.size());
                    buffer.insert(begin, data.substr(0, count));
                    break;
                case InteractionType::Remove:
                    assert(begin <= buffer.size());
                    assert((begin + count) <= buffer.size());
                    buffer.erase(begin, count);
                    break;
            }
        }
        void Apply(rope::Rope& buffer, std::string_view data, bool force_bulk) {
            switch (type) {
                case InteractionType::Insert:
                    buffer.Insert(begin, data.substr(0, count), force_bulk);
                    break;
                case InteractionType::Remove:
                    buffer.Remove(begin, count);
                    break;
            }
        }

        std::string ToString() {
            std::string_view type_name = type == InteractionType::Insert ? "insert" : "remove";
            return std::string{type_name} + "(" + std::to_string(begin) + "," + std::to_string(count) + ")";
        }
    };

   protected:
    std::mt19937 generator;
    std::string data_source = "";
    size_t current_buffer_size = 0;

    size_t rnd() { return static_cast<size_t>(generator()); }

   public:
    RopeInteractionGenerator(std::mt19937& rnd, size_t max_bytes) : generator(rnd) {
        data_source.reserve(max_bytes);
        for (size_t i = 0; i < max_bytes; ++i) {
            data_source.push_back(48 + (rnd() % (57 - 48)));
        }
    }
    std::string ReleaseDataSource() { return std::move(data_source); }
    Interaction GenerateOne() {
        size_t begin = (current_buffer_size == 0) ? 0 : (rnd() % current_buffer_size);
        assert(begin <= current_buffer_size);
        if ((rnd() & 0b1) == 0) {
            size_t count = rnd() % data_source.size();
            current_buffer_size += count;
            return {.type = InteractionType::Insert, .begin = begin, .count = count};
        } else {
            size_t end = begin + ((begin == current_buffer_size) ? 0 : (rnd() % (current_buffer_size - begin)));
            assert((end - begin) <= current_buffer_size);
            current_buffer_size -= end - begin;
            return {
                .type = InteractionType::Remove,
                .begin = begin,
                .count = end - begin,
            };
        }
    }

    static std::pair<std::vector<Interaction>, std::string> GenerateMany(std::mt19937& rnd, size_t n,
                                                                         size_t max_bytes) {
        RopeInteractionGenerator gen{rnd, max_bytes};
        std::vector<Interaction> out;
        for (size_t i = 0; i < n; ++i) {
            out.push_back(gen.GenerateOne());
        }
        return {out, gen.ReleaseDataSource()};
    }
};

struct RopeFuzzerTest {
    size_t page_size;
    size_t max_bytes;
    size_t interaction_count;
    bool force_bulk;
    uint32_t seed;
};

struct RopeFuzzerTestPrinter {
    std::string operator()(const ::testing::TestParamInfo<RopeFuzzerTest>& info) const {
        auto& test = info.param;
        return std::to_string(test.page_size) + "_" + std::to_string(test.interaction_count) + "_" +
               std::to_string(test.max_bytes) + "_" + std::to_string(test.force_bulk) + "_" + std::to_string(test.seed);
    }
};

inline void operator<<(std::ostream& out, const RopeFuzzerTest& p) {
    out << p.page_size << "_" << p.interaction_count << "_" << p.max_bytes << "_" << p.force_bulk << "_" << p.seed;
}

inline std::vector<RopeFuzzerTest> generateTestSeries(size_t page_size, size_t interaction_count, size_t max_bytes,
                                                      size_t test_count, bool force_bulk = false) {
    std::vector<RopeFuzzerTest> tests;
    tests.reserve(test_count);
    for (uint32_t i = 0; i < test_count; ++i) {
        tests.push_back(RopeFuzzerTest{.page_size = page_size,
                                       .max_bytes = max_bytes,
                                       .interaction_count = interaction_count,
                                       .force_bulk = force_bulk,
                                       .seed = i});
    }
    return tests;
}

struct RopeFuzzerTestSuite : public ::testing::TestWithParam<RopeFuzzerTest> {
    static void readRandomRange(std::mt19937& rnd, const std::string& text_buffer, const rope::Rope& rope_buffer) {
        if (text_buffer.empty()) {
            return;
        }
        auto o = rnd() % text_buffer.size();
        auto n = rnd() % (text_buffer.size() - o);
        auto expected = std::string_view{text_buffer}.substr(o, n);
        std::string tmp;
        auto result = rope_buffer.Read(o, n, tmp);
        ASSERT_EQ(expected, result);
    }
    static void readRandomRanges(std::mt19937& rnd, const std::string& text_buffer, const rope::Rope& rope_buffer,
                                 size_t n) {
        for (size_t i = 0; i < n; ++i) {
            readRandomRange(rnd, text_buffer, rope_buffer);
        }
    }
};

TEST_P(RopeFuzzerTestSuite, Test) {
    auto& test = GetParam();
    std::mt19937 rnd{test.seed};
    rope::Rope target{test.page_size};
    std::string expected;
    auto [input_ops, data_buffer] = RopeInteractionGenerator::GenerateMany(rnd, test.interaction_count, test.max_bytes);
    for (size_t i = 0; i < input_ops.size(); ++i) {
        auto& op = input_ops[i];
        op.Apply(expected, data_buffer);
        op.Apply(target, data_buffer, test.force_bulk);
        ASSERT_NO_THROW(target.CheckIntegrity()) << "[" << i << "] " << op.ToString();
        ASSERT_EQ(target.ToString(), expected) << "[" << i << "] " << op.ToString() << " " << data_buffer;
        readRandomRanges(rnd, expected, target, 8);
    }
}

}  // namespace

#endif  // DASHQL_CORE_TEST_ROPE_FUZZER_COMMON_H_
