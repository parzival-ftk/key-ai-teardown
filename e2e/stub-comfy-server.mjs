/**
 * Stub ComfyUI Server —— 模拟 ComfyUI 的最小可用端点，用于本地验证与演示。
 *
 * 用法：
 *   node e2e/stub-comfy-server.mjs            # 默认监听 8188
 *   PORT=8288 node e2e/stub-comfy-server.mjs
 *
 * 实现（零依赖，手写 WebSocket 握手与文本帧）：
 *   GET  /object_info      节点自省 —— 与真实 ComfyUI 同形，供 scripts/comfy-doctor.mjs 比对
 *   POST /upload/image     multipart 上传 → { name, subfolder, type }
 *   POST /prompt           { prompt, client_id } → { prompt_id }
 *   GET  /view?filename=…  返回一张真的 PNG（灰度渐变，便于肉眼确认「结果落回画布」）
 *   WS   /ws?clientId=…    连上后按序推送 progress / executing / executed
 *
 * 它**不生成真图**：只回一张占位 PNG。用途是打通并验证「上传→提交→进度→落图」这条链路，
 * 不是替代真实推理。
 */
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8188);
/** 占位图边长 */
const IMAGE_SIZE = Number(process.env.IMAGE_SIZE ?? 256);
/** 从 /prompt 到推送结果之间的间隔（毫秒），让进度条看得见 */
const STEP_DELAY_MS = Number(process.env.STEP_DELAY_MS ?? 250);

/* ── 一张真的 PNG（8 位灰度，横向渐变） ── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function buildGrayscalePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  const raw = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const diagonal = Math.abs(x - y) < 6 ? 255 : 0;
      raw[rowStart + 1 + x] = diagonal || Math.round((x / size) * 200) + 30;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PLACEHOLDER_PNG = buildGrayscalePng(IMAGE_SIZE);

/* ── /object_info：与真实 ComfyUI 同形（节选本仓用到的节点） ── */

const SUBFOLDER = [""];
const objectInfo = {
  LoadImage: {
    input: { required: { image: [["example.png"], { image_upload: true }] } },
    output: ["IMAGE", "MASK"],
    output_name: ["IMAGE", "MASK"],
  },
  LoadImageMask: {
    input: {
      required: {
        image: [["example.png"], { image_upload: true }],
        channel: [["alpha", "red", "green", "blue"]],
      },
    },
    output: ["MASK"],
    output_name: ["MASK"],
  },
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [["v1-5-pruned-emaonly.safetensors"]] } },
    output: ["MODEL", "CLIP", "VAE"],
    output_name: ["MODEL", "CLIP", "VAE"],
  },
  VAEEncodeForInpaint: {
    input: {
      required: {
        pixels: ["IMAGE"],
        vae: ["VAE"],
        mask: ["MASK"],
        grow_mask_by: ["INT", { default: 6, min: 0, max: 64 }],
      },
    },
    output: ["LATENT"],
    output_name: ["LATENT"],
  },
  CLIPTextEncode: {
    input: { required: { text: ["STRING", { multiline: true }], clip: ["CLIP"] } },
    output: ["CONDITIONING"],
    output_name: ["CONDITIONING"],
  },
  EmptyLatentImage: {
    input: {
      required: {
        width: ["INT", { default: 512, min: 16, max: 16384 }],
        height: ["INT", { default: 512, min: 16, max: 16384 }],
        batch_size: ["INT", { default: 1, min: 1, max: 4096 }],
      },
    },
    output: ["LATENT"],
    output_name: ["LATENT"],
  },
  KSampler: {
    input: {
      required: {
        model: ["MODEL"],
        seed: ["INT", { default: 0, min: 0, max: 0xffffffff }],
        steps: ["INT", { default: 20, min: 1, max: 10000 }],
        cfg: ["FLOAT", { default: 8, min: 0, max: 100 }],
        sampler_name: [["euler", "euler_ancestral", "dpmpp_2m", "ddim"]],
        scheduler: [["normal", "karras", "exponential"]],
        positive: ["CONDITIONING"],
        negative: ["CONDITIONING"],
        latent_image: ["LATENT"],
        denoise: ["FLOAT", { default: 1, min: 0, max: 1 }],
      },
    },
    output: ["LATENT"],
    output_name: ["LATENT"],
  },
  VAEDecode: {
    input: { required: { samples: ["LATENT"], vae: ["VAE"] } },
    output: ["IMAGE"],
    output_name: ["IMAGE"],
  },
  SaveImage: {
    input: {
      required: {
        images: ["IMAGE"],
        filename_prefix: ["STRING", { default: "ComfyUI" }],
      },
      hidden: { prompt: "PROMPT", extra_pnginfo: "EXTRA_PNGINFO" },
    },
    output: [],
    output_name: [],
  },
};

/* ── 手写 WebSocket（只需文本帧，够本 stub 用） ── */

const sockets = new Map(); // clientId → socket
const promptHistory = new Map(); // promptId → 执行记录（GET /history/<id> 用）

function wsAccept(key) {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function wsSend(socket, payload) {
  const data = Buffer.from(JSON.stringify(payload), "utf8");
  const header =
    data.length < 126
      ? Buffer.from([0x81, data.length])
      : Buffer.concat([Buffer.from([0x81, 126]), (() => {
          const b = Buffer.alloc(2);
          b.writeUInt16BE(data.length, 0);
          return b;
        })()]);
  try {
    socket.write(Buffer.concat([header, data]));
  } catch {
    /* 对端已断开 */
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/* ── 服务器 ── */

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  /**
   * CORS —— 这一步不是可选的：页面跑在 localhost:3000/3100，而 ComfyUI 在 127.0.0.1:8188，
   * 属于跨源。真实 ComfyUI 需要 `python main.py --enable-cors-header` 才会回这些头；
   * 缺了它，浏览器侧表现为 `Failed to fetch`（W32 实测踩到）。
   * 另外 `/prompt` 发的是 application/json（非 safelisted），会先发 OPTIONS 预检。
   */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && url.pathname === "/object_info") {
    return json(200, objectInfo);
  }

  if (req.method === "GET" && url.pathname === "/system_stats") {
    return json(200, {
      system: { comfyui_version: "stub-0.1.0", python_version: "stub" },
      devices: [{ name: "stub-device", type: "cpu" }],
    });
  }

  if (req.method === "GET" && url.pathname === "/view") {
    const filename = url.searchParams.get("filename") ?? "";
    if (!filename) return json(400, { error: "missing filename" });
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    return res.end(PLACEHOLDER_PNG);
  }

  if (req.method === "POST" && url.pathname === "/upload/image") {
    const raw = await readBody(req);
    // multipart 里至少要有内容；名字从 filename 字段里取（够用）
    const match = /filename="([^"]+)"/.exec(raw.toString("latin1"));
    const base = (match?.[1] ?? "uploaded.png").replace(/[^\w.-]/g, "_");
    const name = `${Date.now()}-${base}`;
    return json(200, { name, subfolder: SUBFOLDER[0], type: "input" });
  }

  if (req.method === "POST" && url.pathname === "/prompt") {
    const raw = await readBody(req);
    let payload = {};
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      payload = {};
    }
    const clientId = payload.client_id ?? null;
    const graph = payload.prompt ?? {};
    const nodeIds = Object.keys(graph);
    const promptId = randomUUID();

    // 输出挂在 SaveImage 节点上（找不到就退化为最后一个节点）
    const saveEntry = Object.entries(graph).find(([, node]) => node?.class_type === "SaveImage");
    const saveNodeId = saveEntry ? saveEntry[0] : nodeIds[nodeIds.length - 1] ?? null;
    const prefix = saveEntry?.[1]?.inputs?.filename_prefix ?? "key_stub";
    const image = {
      filename: `${prefix}_${String(Date.now()).slice(-8)}.png`,
      subfolder: SUBFOLDER[0],
      type: "output",
    };

    // 「执行」：延迟后写入 history（供 GET /history/<id> 轮询），同时向已连的 WS 推状态流
    void (async () => {
      const socket = clientId ? sockets.get(clientId) : null;
      const steps = [
        { type: "executing", data: { node: nodeIds[0] ?? null } },
        { type: "progress", data: { value: 1, max: 4 } },
        { type: "progress", data: { value: 2, max: 4 } },
        { type: "progress", data: { value: 3, max: 4 } },
        { type: "progress", data: { value: 4, max: 4 } },
      ];
      for (const step of steps) {
        await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
        if (socket) wsSend(socket, step);
      }
      promptHistory.set(promptId, {
        prompt: [1, promptId, graph, {}, nodeIds],
        outputs: saveNodeId ? { [saveNodeId]: { images: [image] } } : {},
        status: { status_str: "success", completed: true, messages: [] },
      });
      if (socket) {
        await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
        wsSend(socket, { type: "executing", data: { node: null } });
        wsSend(socket, {
          type: "executed",
          data: {
            node: saveNodeId,
            display_node: saveNodeId,
            prompt_id: promptId,
            output: { images: [image] },
          },
        });
      }
    })();

    return json(200, { prompt_id: promptId, number: 1 });
  }

  // 执行结果（与真实 ComfyUI 同形）：未完成/未知的 prompt_id 返回 {}
  if (req.method === "GET" && url.pathname === "/history") {
    return json(200, Object.fromEntries(promptHistory));
  }
  if (req.method === "GET" && url.pathname.startsWith("/history/")) {
    const id = decodeURIComponent(url.pathname.slice("/history/".length));
    const entry = promptHistory.get(id);
    return json(200, entry ? { [id]: entry } : {});
  }

  return json(404, { error: "not found", path: url.pathname });
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${wsAccept(key)}`,
      "",
      "",
    ].join("\r\n"),
  );
  const clientId = url.searchParams.get("clientId") ?? "";
  if (clientId) sockets.set(clientId, socket);
  socket.on("close", () => {
    if (clientId) sockets.delete(clientId);
  });
  socket.on("error", () => {
    if (clientId) sockets.delete(clientId);
  });
  // 连上即报一次 status，便于确认握手成功
  wsSend(socket, { type: "status", data: { status: { exec_info: { queue_remaining: 0 } } } });
});

server.listen(PORT, () => {
  console.log(`stub ComfyUI listening on http://127.0.0.1:${PORT}  (ws://127.0.0.1:${PORT}/ws?clientId=…)`);
  console.log("  /object_info  /upload/image  /prompt  /view  /system_stats  + WS");
});
