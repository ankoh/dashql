import {describe, expect, it} from "vitest";

import {architectureName, updateFeedUrl, updateFeedUrlForChannel} from "./update_feed.js";

describe("updateFeedUrl", () => {
    it("selects stable and arm64", () => {
        expect(updateFeedUrl("1.2.3", "arm64")).toBe("https://get.dashql.app/channels/stable/macos/arm64");
    });

    it("selects latest and x64", () => {
        expect(updateFeedUrl("1.2.4-dev.3", "x64")).toBe("https://get.dashql.app/channels/latest/macos/x64");
    });

    it("allows a stable installation to explicitly select the latest feed", () => {
        expect(updateFeedUrlForChannel("latest", "arm64")).toBe("https://get.dashql.app/channels/latest/macos/arm64");
    });
});

describe("architectureName", () => {
    it("rejects unsupported architectures", () => {
        expect(() => architectureName("ia32")).toThrow("Unsupported update architecture");
    });
});
