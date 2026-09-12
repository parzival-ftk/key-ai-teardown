/**
 * 图片（截图）解析器（Wave 4.2）—— 校验并规整用户上传的截图。
 *
 * 截图不抽取文本，而是作为多模态输入交给 Vision 模型识别；
 * 本模块只负责「是不是合法、可用的图片 data URL」以及体积约束，
 * 与「抓取 / 抽取文本」的 url、pdf 解析器职责不同。
 */

/** 支持的图片 MIME（覆盖浏览器截图常见的 png/jpeg/webp） */
export const SUPPORTED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
] as const;

export interface ImageParseResult {
  ok: boolean;
  /** 规整后的 data URL（去除 base64 中的空白） */
  dataUrl: string;
  mimeType: string;
  /** 解码后字节数 */
  bytes: number;
  error?: string;
}

export interface ParseImageOptions {
  /** 解码后最大字节数，默认 6MB */
  maxBytes?: number;
}

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;
const DEFAULT_MAX_BYTES = 6 * 1024 * 1024;

/** 由 base64 长度推算解码字节数（不真正解码，避免大字符串开销） */
export function base64ByteLength(b64: string): number {
  if (!b64) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function fail(error: string): ImageParseResult {
  return { ok: false, dataUrl: "", mimeType: "", bytes: 0, error };
}

/**
 * 校验并规整图片 data URL。失败返回 ok:false（不抛错），
 * 由调用方决定是降级还是提示用户。
 */
export function parseImageDataUrl(
  raw: string,
  options: ParseImageOptions = {},
): ImageParseResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const dataUrl = (raw ?? "").trim();
  if (!dataUrl) return fail("图片内容为空");

  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    return fail("仅支持 base64 编码的图片 data URL（png / jpeg / webp / gif）");
  }

  const mimeType = match[1].toLowerCase();
  if (!(SUPPORTED_IMAGE_MIME as readonly string[]).includes(mimeType)) {
    return fail(`不支持的图片类型：${mimeType}`);
  }

  const b64 = match[2].replace(/\s+/g, "");
  const bytes = base64ByteLength(b64);
  if (bytes === 0) return fail("图片数据为空");
  if (bytes > maxBytes) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return fail(`图片过大（${mb}MB），上限 ${maxBytes / 1024 / 1024}MB`);
  }

  return { ok: true, dataUrl: `data:${mimeType};base64,${b64}`, mimeType, bytes };
}
