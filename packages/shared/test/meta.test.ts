import { describe, expect, it } from "vitest";
import { ATTRIBUTION, attributionText } from "../src/meta.ts";

describe("attribution (add-footer F1)", () => {
  it("builds the attribution text of design F1", () => {
    expect(attributionText()).toBe(
      "KIPscope © 2026 Jan Kipping, Agentic engineer, https://kipp.ing · Attribution Assurance License (AAL)",
    );
  });

  it("pins the constants the footer markup uses", () => {
    expect(ATTRIBUTION).toMatchObject({
      product: "KIPscope",
      year: 2026,
      author: "Jan Kipping",
      identification: "Agentic engineer",
      url: "https://kipp.ing",
      urlLabel: "kipp.ing",
      slogan: "efficient agentic engineering",
      license: { spdx: "AAL", name: "Attribution Assurance License", path: "/api/license" },
    });
  });
});
