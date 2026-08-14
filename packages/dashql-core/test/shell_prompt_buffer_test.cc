#include "dashql/shell/prompt_buffer.h"

#include "dashql/catalog.h"
#include "gtest/gtest.h"

namespace dashql::shell {
namespace {

struct PromptBufferTest : public testing::Test {
    Catalog catalog;
    PromptBuffer prompt{catalog};
};

TEST_F(PromptBufferTest, SetsValidUtf8AndRejectsInvalidUtf8) {
    EXPECT_TRUE(prompt.SetText("select 界"));
    EXPECT_EQ(prompt.Text(), "select 界");
    EXPECT_EQ(prompt.cursor_byte_offset(), prompt.Text().size());
    EXPECT_EQ(prompt.cursor_codepoint_offset(), 8);
    EXPECT_EQ(prompt.grapheme_count(), 8);
    EXPECT_EQ(prompt.revision(), 1);

    EXPECT_FALSE(prompt.SetText(std::string_view{"\xc3\x28", 2}));
    EXPECT_EQ(prompt.Text(), "select 界");
    EXPECT_EQ(prompt.revision(), 1);
}

TEST_F(PromptBufferTest, MovesAcrossExtendedGraphemeClusters) {
    ASSERT_TRUE(prompt.SetText("a👩‍💻é"));
    const auto end = prompt.Text().size();

    EXPECT_TRUE(prompt.MoveLeft());
    EXPECT_EQ(prompt.cursor_byte_offset(), end - std::string{"é"}.size());
    EXPECT_TRUE(prompt.MoveLeft());
    EXPECT_EQ(prompt.cursor_byte_offset(), 1);
    EXPECT_TRUE(prompt.MoveLeft());
    EXPECT_EQ(prompt.cursor_byte_offset(), 0);
    EXPECT_FALSE(prompt.MoveLeft());

    EXPECT_TRUE(prompt.MoveRight());
    EXPECT_EQ(prompt.cursor_byte_offset(), 1);
    EXPECT_TRUE(prompt.MoveRight());
    EXPECT_EQ(prompt.cursor_byte_offset(), end - std::string{"é"}.size());
    EXPECT_TRUE(prompt.MoveRight());
    EXPECT_EQ(prompt.cursor_byte_offset(), end);
    EXPECT_FALSE(prompt.MoveRight());
}

TEST_F(PromptBufferTest, MovesToPromptStartAndEnd) {
    ASSERT_TRUE(prompt.SetText("a👩‍💻é"));

    EXPECT_TRUE(prompt.MoveToStart());
    EXPECT_EQ(prompt.cursor_byte_offset(), 0u);
    EXPECT_FALSE(prompt.MoveToStart());

    EXPECT_TRUE(prompt.MoveToEnd());
    EXPECT_EQ(prompt.cursor_byte_offset(), prompt.Text().size());
    EXPECT_FALSE(prompt.MoveToEnd());
}

TEST_F(PromptBufferTest, MovesVerticallyAcrossLinesByGraphemeColumn) {
    ASSERT_TRUE(prompt.SetText("ab界\nx\n1234"));

    EXPECT_TRUE(prompt.MoveUp());
    EXPECT_EQ(prompt.cursor_byte_offset(), std::string{"ab界\nx"}.size());
    EXPECT_TRUE(prompt.MoveUp());
    EXPECT_EQ(prompt.cursor_byte_offset(), 1u);
    EXPECT_FALSE(prompt.MoveUp());

    EXPECT_TRUE(prompt.MoveDown());
    EXPECT_EQ(prompt.cursor_byte_offset(), std::string{"ab界\nx"}.size());
    EXPECT_TRUE(prompt.MoveDown());
    EXPECT_EQ(prompt.cursor_byte_offset(), std::string{"ab界\nx\n1"}.size());
    EXPECT_FALSE(prompt.MoveDown());
}

TEST_F(PromptBufferTest, InsertsAndDeletesWholeGraphemeClusters) {
    ASSERT_TRUE(prompt.SetText("ac"));
    ASSERT_TRUE(prompt.MoveLeft());

    EXPECT_TRUE(prompt.Insert("👩‍💻"));
    EXPECT_EQ(prompt.Text(), "a👩‍💻c");
    EXPECT_EQ(prompt.revision(), 2);

    EXPECT_TRUE(prompt.DeleteBackward());
    EXPECT_EQ(prompt.Text(), "ac");
    EXPECT_EQ(prompt.cursor_byte_offset(), 1);
    EXPECT_EQ(prompt.revision(), 3);

    EXPECT_TRUE(prompt.DeleteForward());
    EXPECT_EQ(prompt.Text(), "a");
    EXPECT_EQ(prompt.cursor_byte_offset(), 1);
    EXPECT_EQ(prompt.revision(), 4);
    EXPECT_FALSE(prompt.DeleteForward());
    EXPECT_EQ(prompt.revision(), 4);
}

TEST_F(PromptBufferTest, KeepsCursorOnBoundaryWhenInsertionJoinsGraphemes) {
    ASSERT_TRUE(prompt.SetText("👩💻"));
    ASSERT_TRUE(prompt.MoveLeft());

    EXPECT_TRUE(prompt.Insert("‍"));
    EXPECT_EQ(prompt.Text(), "👩‍💻");
    EXPECT_EQ(prompt.grapheme_count(), 1);
    EXPECT_EQ(prompt.cursor_byte_offset(), prompt.Text().size());

    EXPECT_TRUE(prompt.DeleteBackward());
    EXPECT_TRUE(prompt.Text().empty());
}

TEST_F(PromptBufferTest, OnlyMovesCursorToGraphemeBoundaries) {
    ASSERT_TRUE(prompt.SetText("界x"));

    EXPECT_FALSE(prompt.MoveToByteOffset(1));
    EXPECT_EQ(prompt.cursor_byte_offset(), prompt.Text().size());
    EXPECT_TRUE(prompt.MoveToByteOffset(std::string{"界"}.size()));
    EXPECT_EQ(prompt.cursor_byte_offset(), std::string{"界"}.size());
    EXPECT_EQ(prompt.revision(), 1);
}

TEST_F(PromptBufferTest, EmptyEditsDoNotAdvanceRevision) {
    EXPECT_EQ(prompt.grapheme_count(), 0);
    EXPECT_FALSE(prompt.Insert(""));
    EXPECT_FALSE(prompt.DeleteBackward());
    EXPECT_FALSE(prompt.DeleteForward());
    EXPECT_EQ(prompt.revision(), 0);

    EXPECT_TRUE(prompt.SetText(""));
    EXPECT_EQ(prompt.revision(), 0);
    EXPECT_FALSE(prompt.Insert(std::string_view{"\xff", 1}));
    EXPECT_EQ(prompt.revision(), 0);

    EXPECT_TRUE(prompt.SetText("x"));
    EXPECT_EQ(prompt.revision(), 1);
    EXPECT_TRUE(prompt.SetText("x"));
    EXPECT_EQ(prompt.revision(), 1);
}

}  // namespace
}  // namespace dashql::shell
