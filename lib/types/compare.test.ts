import { describe, it, expect } from "vitest";
import {
  MAX_COMPARE_PRODUCTS,
  MIN_COMPARE_PRODUCTS,
  parseCompareBrief,
  safeParseCompareBrief,
} from "./compare";

const product = (name: string) => ({ name });

describe("CompareBrief 校验（W11）", () => {
  it("接受 2-3 个产品", () => {
    expect(
      safeParseCompareBrief({ products: [product("A"), product("B")] }).success,
    ).toBe(true);
    expect(
      safeParseCompareBrief({
        products: [product("A"), product("B"), product("C")],
      }).success,
    ).toBe(true);
  });

  it("少于 2 或多于 3 个产品 → 校验失败", () => {
    expect(safeParseCompareBrief({ products: [product("A")] }).success).toBe(
      false,
    );
    expect(
      safeParseCompareBrief({
        products: [product("A"), product("B"), product("C"), product("D")],
      }).success,
    ).toBe(false);
  });

  it("产品缺名称 → 校验失败（复用 ProductBrief 契约）", () => {
    expect(
      safeParseCompareBrief({ products: [{}, product("B")] }).success,
    ).toBe(false);
  });

  it("parseCompareBrief 在校验失败时抛错", () => {
    expect(() => parseCompareBrief({ products: [] })).toThrow();
  });

  it("常量：最少 2、最多 3", () => {
    expect(MIN_COMPARE_PRODUCTS).toBe(2);
    expect(MAX_COMPARE_PRODUCTS).toBe(3);
  });
});
