import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "./concurrency";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runWithConcurrency（并发受限 map）", () => {
  it("结果按输入顺序对齐（与完成先后无关）", async () => {
    const out = await runWithConcurrency([30, 5, 15], 2, async (ms) => {
      await sleep(ms);
      return ms;
    });
    expect(out).toEqual([30, 5, 15]);
  });

  it("并发数不超过 limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("limit ≥ 项数时全部并行", async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency([1, 2, 3], 10, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight -= 1;
    });
    expect(peak).toBe(3);
  });

  it("空输入返回空数组", async () => {
    expect(await runWithConcurrency([], 2, async () => 1)).toEqual([]);
  });

  it("limit ≤ 0 夹到 1（串行，不空转）", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await runWithConcurrency([1, 2, 3], 0, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(2);
      inFlight -= 1;
      return n;
    });
    expect(peak).toBe(1);
    expect(out).toEqual([1, 2, 3]);
  });

  it("worker 抛错向上传播", async () => {
    await expect(
      runWithConcurrency([1], 2, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
