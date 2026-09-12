import { describe, it, expect } from "vitest";
import {
  parseImageDataUrl,
  base64ByteLength,
  SUPPORTED_IMAGE_MIME,
} from "./image";

// 1x1 透明 PNG 的 base64（真实图元，用于通过格式校验）
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("图片（截图）解析器（Wave 4.2）", () => {
  it("接受合法的 png data URL 并计算字节数", () => {
    const r = parseImageDataUrl(PNG_1X1);
    expect(r.ok).toBe(true);
    expect(r.mimeType).toBe("image/png");
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("去掉 base64 中的空白字符", () => {
    const withSpace = PNG_1X1.replace("base64,", "base64,\n  ");
    const r = parseImageDataUrl(withSpace);
    expect(r.ok).toBe(true);
    expect(r.dataUrl).not.toContain("\n");
  });

  it("空内容 / 非 data URL 返回 ok:false", () => {
    expect(parseImageDataUrl("").ok).toBe(false);
    expect(parseImageDataUrl("https://x.com/a.png").ok).toBe(false);
    expect(parseImageDataUrl("data:text/plain;base64,aGk=").ok).toBe(false);
  });

  it("不支持的图片类型返回 ok:false", () => {
    const r = parseImageDataUrl("data:image/tiff;base64,AAAA");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("不支持");
  });

  it("超过体积上限返回 ok:false", () => {
    const r = parseImageDataUrl(PNG_1X1, { maxBytes: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("过大");
  });

  it("base64ByteLength 处理 padding", () => {
    // "aGk=" 解码为 "hi"（2 字节）
    expect(base64ByteLength("aGk=")).toBe(2);
    // "aGVsbG8=" 解码为 "hello"（5 字节）
    expect(base64ByteLength("aGVsbG8=")).toBe(5);
    expect(base64ByteLength("")).toBe(0);
  });

  it("支持的 MIME 白名单非空且含 png/jpeg", () => {
    expect(SUPPORTED_IMAGE_MIME).toContain("image/png");
    expect(SUPPORTED_IMAGE_MIME).toContain("image/jpeg");
  });
});
