#include "dashql/utils/string_conversion.h"

#include <string>
#include <string_view>

#include "gtest/gtest.h"

using namespace dashql;

namespace {

std::string quote(std::string_view text) {
    std::string tmp;
    return std::string{quote_anyupper_fuzzy(text, tmp)};
}

TEST(StringConversionTest, BareIdentifierStaysUnquoted) {
    EXPECT_EQ(quote("foo"), "foo");
    EXPECT_EQ(quote("foo_bar"), "foo_bar");
    EXPECT_EQ(quote("_foo"), "_foo");
    EXPECT_EQ(quote("foo123"), "foo123");
    EXPECT_EQ(quote("foo$bar"), "foo$bar");
}

TEST(StringConversionTest, UpperCaseGetsQuoted) {
    EXPECT_EQ(quote("Foo"), "\"Foo\"");
    EXPECT_EQ(quote("FOO"), "\"FOO\"");
}

TEST(StringConversionTest, InvalidBareCharactersGetQuoted) {
    // Slash isn't a valid identifier character, so it must be quoted.
    EXPECT_EQ(quote("vis_data/vega_cars"), "\"vis_data/vega_cars\"");
    EXPECT_EQ(quote("a.b"), "\"a.b\"");
    EXPECT_EQ(quote("a b"), "\"a b\"");
    EXPECT_EQ(quote("a-b"), "\"a-b\"");
}

TEST(StringConversionTest, LeadingDigitGetsQuoted) {
    EXPECT_EQ(quote("123abc"), "\"123abc\"");
}

TEST(StringConversionTest, EmptyGetsQuoted) {
    EXPECT_EQ(quote(""), "\"\"");
}

TEST(StringConversionTest, EmbeddedQuotesAreDoubled) {
    EXPECT_EQ(quote("a\"b"), "\"a\"\"b\"");
}

}  // namespace
