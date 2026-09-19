import { parseImageDataUrl } from "@/lib/parsers/image";
import type { AnalysisInput } from "./provider";

/**
 * 截图输入（阶段 15，spec §8）。
 *
 * 只接受 PNG / JPG / WEBP；复用既有 `parseImageDataUrl` 做体积与类型校验，
 * 校验失败返回可读原因（不抛错），由 UI 呈现。
 */

export type ImageInputResult =
  | { ok: true; input: AnalysisInput }
  | { ok: false; error: string };

/** 校验并规整一张截图（raw 可为 data URL，file 名可选） */
export function toAnalysisInput(raw: string, fileName?: string): ImageInputResult {
  const parsed = parseImageDataUrl(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "图片不合法" };
  const mimeType = parsed.mimeType;
  // 明确收窄到 spec 要求的三种格式（gif 虽被解析器接受，但不在本阶段范围）
  if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType)) {
    return { ok: false, error: `仅支持 PNG / JPG / WEBP，收到 ${mimeType}` };
  }
  return {
    ok: true,
    input: {
      imageDataUrl: parsed.dataUrl,
      mimeType,
      ...(fileName ? { fileName } : {}),
    },
  };
}

/** 浏览器：把 File 读成 data URL（非浏览器环境抛错，由调用方兜底） */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}
