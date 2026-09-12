import { describe, it, expect } from "vitest";
import { parsePdf, normalizePdfText, toUint8Array } from "./pdf";

/**
 * 手工构造一个最小可解析 PDF（含一段可提取文本）。
 * 与 .rivet/scratch/pdf-probe.mjs 的探针一致，已验证 node/PDFViewer 可提取。
 */
function buildMinimalPdf(text: string): Uint8Array {
  const objs: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    5: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  };
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objs[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

  let body = "%PDF-1.4\n";
  const offsets: Record<number, number> = {};
  for (let i = 1; i <= 5; i++) {
    offsets[i] = body.length;
    body += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = body.length;
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(Buffer.from(body + xref + trailer, "latin1"));
}

describe("PDF 解析器（Wave 4.3）", () => {
  it("normalizePdfText 折叠行内空白、压缩空行、统一换行", () => {
    expect(normalizePdfText("  多  个   空格 \r\n\r\n\r\n 段落  ")).toBe(
      "多 个 空格\n\n段落",
    );
    expect(normalizePdfText("a\t\tb")).toBe("a b");
    expect(normalizePdfText("x\n\n\n\n\ny")).toBe("x\n\ny");
  });

  it("toUint8Array 同时接受 Uint8Array 与 ArrayBuffer", () => {
    const u8 = new Uint8Array([1, 2, 3]);
    expect(toUint8Array(u8)).toBe(u8);
    const buf = u8.buffer;
    expect(Array.from(toUint8Array(buf))).toEqual([1, 2, 3]);
  });

  it("从最小 PDF 提取文本", async () => {
    const r = await parsePdf(buildMinimalPdf("Hello Key PDF"));
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Hello Key PDF");
    expect(r.pages).toBe(1);
  });

  it("接受 Node Buffer（回归：unpdf 拒绝 Buffer，须转纯 Uint8Array）", async () => {
    const r = await parsePdf(Buffer.from(buildMinimalPdf("Buf Case")));
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Buf Case");
  });

  it("maxChars 截断提取文本", async () => {
    const r = await parsePdf(buildMinimalPdf("Hello Key PDF"), { maxChars: 5 });
    expect(r.text.length).toBeLessThanOrEqual(5);
    expect(r.ok).toBe(true);
  });

  it("空输入返回 ok:false 且不抛错", async () => {
    const r = await parsePdf(new Uint8Array([]));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("空");
  });

  it("非法字节返回 ok:false（解析失败，不抛错）", async () => {
    const r = await parsePdf(new Uint8Array([1, 2, 3, 4, 5]));
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });
});
