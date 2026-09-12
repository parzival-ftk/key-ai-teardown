/**
 * 并发受限的 map（W11 · 对比矩阵）。
 *
 * 对比模式会对每个产品各跑一遍完整编队——若 N 个产品同时开跑，上游会瞬间收到
 * N × 编队规模 的并发请求。本工具把同时进行的产品数压到 limit 以内，
 * 是「成本与延迟线性上升」的收敛手段。
 *
 * 语义与 Promise.all 一致：结果按输入下标对齐（同序），空输入返回空数组。
 * limit ≤ 0 或非有限值一律夹到 1（至少跑一个，绝不空转）。
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  const safeLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
  const size = Math.max(1, Math.min(safeLimit, items.length));

  let cursor = 0;
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
