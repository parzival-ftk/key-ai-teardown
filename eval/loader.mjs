// Node ESM 解析钩子：把 TS 项目的 `@/…` 别名映射到仓库根，并补齐省略的扩展名。
// 仅供 eval CLI 使用（见 eval/register.mjs），不影响 Next 的构建。

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".json"];

function resolveExisting(base) {
  const candidates = [];
  if (path.extname(base)) {
    candidates.push(base);
  } else {
    for (const ext of EXTENSIONS) candidates.push(base + ext);
  }
  for (const ext of EXTENSIONS) candidates.push(path.join(base, "index" + ext));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = path.join(projectRoot, specifier.slice(2));
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    const resolved = resolveExisting(base);
    if (resolved) return next(pathToFileURL(resolved).href, context);
  }
  return next(specifier, context);
}
