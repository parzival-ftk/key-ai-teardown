import { extractText } from "unpdf";

/**
 * PDF 解析器（Wave 4.3）—— 从上传的 PDF 提取正文，产出可喂给分析的纯文本。
 *
 * 设计要点（对齐 url.ts 的既有风格）：
 * - 失败不抛错，返回 ok:false（由调用方降级到文本 / 截图输入）；
 * - 扫描件 / 纯图片 PDF 提取不到文本时，给出「改用截图输入」的可操作提示；
 * - 正文按 maxChars 截断，避免超长文本撑爆 prompt。
 */

export interface PdfParseResult {
  text: string;
  pages: number;
  ok: boolean;
  error?: string;
}

export interface ParsePdfOptions {
  /** 提取文本的最大字符数，默认 12000 */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 12_000;

/** 输入统一为「纯」Uint8Array（route 里从 File.arrayBuffer() 拿到的是 ArrayBuffer） */
export function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  // unpdf/pdf.js 明确拒绝 Node Buffer（Uint8Array 子类，instanceof 为真），
  // 会抛 "Please provide binary data as Uint8Array, rather than Buffer"。
  // 故非纯 Uint8Array 时复制一份，避免调用方传入 Buffer 时静默失败。
  return view.constructor === Uint8Array ? view : new Uint8Array(view);
}

/**
 * 规整 PDF 文本：统一换行、折叠行内空白、压缩连续空行。
 * 抽为纯函数，便于用固定输入单测（无需真实 PDF）。
 */
export function normalizePdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parsePdf(
  data: Uint8Array | ArrayBuffer,
  options: ParsePdfOptions = {},
): Promise<PdfParseResult> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  let bytes: Uint8Array;
  try {
    bytes = toUint8Array(data);
  } catch {
    return { text: "", pages: 0, ok: false, error: "PDF 数据格式非法" };
  }
  if (bytes.length === 0) {
    return { text: "", pages: 0, ok: false, error: "PDF 内容为空" };
  }

  try {
    // mergePages:true 直接产出单个字符串（默认的逐页数组模式在
    // 传 Uint8Array 时会触发 worker transfer 报错，实测见 .rivet/scratch 探针）。
    const { text, totalPages } = await extractText(bytes, { mergePages: true });
    const normalized = normalizePdfText(text).slice(0, maxChars);

    if (normalized.length === 0) {
      return {
        text: "",
        pages: totalPages,
        ok: false,
        error:
          "未能从 PDF 提取到文本（可能是扫描件或纯图片 PDF），建议改用截图输入",
      };
    }
    return { text: normalized, pages: totalPages, ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      text: "",
      pages: 0,
      ok: false,
      error: `PDF 解析失败：${detail.slice(0, 200)}`,
    };
  }
}
