// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/program_editor.h"

#include <sstream>

#include "dashql/analyzer/program_instance.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/scanner.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
namespace fb = flatbuffers;

namespace {

template <typename FB>
std::pair<const FB*, flatbuffers::DetachedBuffer> Pack(std::unique_ptr<typename FB::NativeTableType> fbo) {
    flatbuffers::FlatBufferBuilder fbb;
    flatbuffers::Offset<FB> ofs = FB::Pack(fbb, fbo.get());
    fbb.Finish(ofs);
    auto buffer = fbb.Release();
    return {flatbuffers::GetRoot<FB>(buffer.data()), move(buffer)};
}

TEST(ProgramEditorTest, VizStatementAddPosition) {
    auto txt = "VIZ weather_avg USING LINE";
    ProgramInstance instance{txt, move(parser::ParserDriver::Parse(txt))};
    ASSERT_EQ(instance.program().statements.size(), 1);

    ProgramEditor editor{instance};
    std::pair<const proto::edit::ProgramEdit*, flatbuffers::DetachedBuffer> edit;
    {
        auto e = std::make_unique<proto::edit::EditOperationT>();
        proto::edit::VizChangePositionT changePos;
        changePos.position = std::make_unique<proto::viz::VizTile>(1, 2, 3, 4);
        e->statement_id = 0;
        e->variant.Set(move(changePos));
        auto pe = std::make_unique<proto::edit::ProgramEditT>();
        pe->edits.push_back(move(e));
        edit = Pack<proto::edit::ProgramEdit>(move(pe));
    }

    auto expected = "VIZ weather_avg USING LINE (\n    pos = (r = 1, c = 2, w = 3, h = 4)\n)";
    EXPECT_EQ(editor.Apply(*std::get<0>(edit)), expected);
}

TEST(ProgramEditorTest, VizStatementUpdatePosition) {
    auto txt = "VIZ weather_avg USING LINE (\n    pos = (r = 1, c = 2, w = 3, h = 4)\n)";
    ProgramInstance instance{txt, move(parser::ParserDriver::Parse(txt))};
    ASSERT_EQ(instance.program().statements.size(), 1);

    ProgramEditor editor{instance};
    std::pair<const proto::edit::ProgramEdit*, flatbuffers::DetachedBuffer> edit;
    {
        auto e = std::make_unique<proto::edit::EditOperationT>();
        proto::edit::VizChangePositionT changePos;
        changePos.position = std::make_unique<proto::viz::VizTile>(6, 5, 4, 3);
        e->statement_id = 0;
        e->variant.Set(move(changePos));
        auto pe = std::make_unique<proto::edit::ProgramEditT>();
        pe->edits.push_back(move(e));
        edit = Pack<proto::edit::ProgramEdit>(move(pe));
    }

    auto expected = "VIZ weather_avg USING LINE (\n    pos = (r = 6, c = 5, w = 4, h = 3)\n)";
    EXPECT_EQ(editor.Apply(*std::get<0>(edit)), expected);
}

}  // namespace
