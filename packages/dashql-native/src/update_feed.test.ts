import {describe, expect, it} from "vitest";

import {architectureName, channelOf, updateFeedUrlForChannel} from "./update_feed.js";

describe("channelOf", () => {
    it("selects stable for a release and latest for a prerelease", () => {
        expect(channelOf("1.2.3")).toBe("stable");
        expect(channelOf("1.2.4-dev.3")).toBe("latest");
    });
});

describe("updateFeedUrlForChannel", () => {
    it("selects the feed of a channel and an architecture", () => {
        expect(updateFeedUrlForChannel("stable", "arm64")).toBe("https://get.dashql.app/channels/stable/macos/arm64");
        expect(updateFeedUrlForChannel("latest", "x64")).toBe("https://get.dashql.app/channels/latest/macos/x64");
    });
});

describe("architectureName", () => {
    it("rejects unsupported architectures", () => {
        expect(() => architectureName("ia32")).toThrow("Unsupported update architecture");
    });
});
