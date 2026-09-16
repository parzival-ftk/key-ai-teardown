import { describe, it, expect } from "vitest";
import { buildInpaintWorkflow, buildTxt2ImgWorkflow, type ComfyWorkflow } from "./comfy-bridge";
import {
  getAvailableCheckpoints,
  inspectComfyNodeGraph,
  inspectUploadResponse,
  rankFindings,
  renderWorkflowReport,
  summarizeFindings,
  type ComfyObjectInfo,
} from "./comfy-doctor";

/**
 * ComfyUI `/object_info` 的形状（节选真实结构）：
 *   { "<ClassType>": { input: { required: { <名>: [ <类型或可选值数组>, <选项对象>? ] } } } }
 * 类型是**数组**时表示 combo（枚举），数组内容即允许值。
 */
const OBJECT_INFO: ComfyObjectInfo = {
  LoadImage: { input: { required: { image: [["example.png"], { image_upload: true }] } } },
  LoadImageMask: {
    input: {
      required: {
        image: [["example.png"], { image_upload: true }],
        channel: [["alpha", "red", "green", "blue"]],
      },
    },
  },
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: [["sd_xl_base_1.0.safetensors", "v1-5-pruned-emaonly.safetensors"]],
      },
    },
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
  },
  CLIPTextEncode: {
    input: { required: { text: ["STRING", { multiline: true }], clip: ["CLIP"] } },
  },
  KSampler: {
    input: {
      required: {
        model: ["MODEL"],
        seed: ["INT", { default: 0 }],
        steps: ["INT", { default: 20 }],
        cfg: ["FLOAT", { default: 8 }],
        sampler_name: [["euler", "dpmpp_2m"]],
        scheduler: [["normal", "karras"]],
        positive: ["CONDITIONING"],
        negative: ["CONDITIONING"],
        latent_image: ["LATENT"],
        denoise: ["FLOAT", { default: 1 }],
      },
    },
  },
  VAEDecode: { input: { required: { samples: ["LATENT"], vae: ["VAE"] } } },
  SaveImage: {
    input: { required: { images: ["IMAGE"], filename_prefix: ["STRING", { default: "ComfyUI" }] } },
  },
};

const GOOD = buildInpaintWorkflow({
  prompt: "把这里换成一只猫",
  imageName: "canvas-base.png",
  maskName: "canvas-mask.png",
  checkpoint: "sd_xl_base_1.0.safetensors",
  samplerName: "euler",
  scheduler: "normal",
});

const idsOf = (findings: ReturnType<typeof inspectComfyNodeGraph>) =>
  findings.map((f) => f.id);

describe("inspectComfyNodeGraph：本仓的节点图对真实实例应当通过", () => {
  const findings = inspectComfyNodeGraph(GOOD, OBJECT_INFO);

  it("没有任何 fail", () => {
    expect(findings.filter((f) => f.level === "fail")).toEqual([]);
  });

  it("逐个节点都判定 class_type 与输入名存在", () => {
    expect(idsOf(findings).filter((id) => id.startsWith("class:")).length).toBe(9);
    expect(idsOf(findings).filter((id) => id.startsWith("inputs:")).length).toBe(9);
  });

  it("对 channel / ckpt_name / sampler / scheduler 这类 combo 值给出确认", () => {
    const ids = idsOf(findings);
    expect(ids).toContain("combo:2.channel");
    expect(ids).toContain("combo:3.ckpt_name");
    expect(ids).toContain("combo:7.sampler_name");
    expect(ids).toContain("combo:7.scheduler");
    expect(findings.every((f) => f.level === "ok" || f.level === "manual")).toBe(true);
  });

  it("连线指向的节点都在图里（否则给出 fail）", () => {
    expect(idsOf(findings).some((id) => id.startsWith("link:"))).toBe(false);
  });
});

describe("inspectComfyNodeGraph：能真的判 NO（否则这个工具就是摆设）", () => {
  it("节点类不存在 → fail 并点名", () => {
    const bogus: ComfyWorkflow = {
      "1": { class_type: "LoadImageBase64", inputs: { image: "x.png" } },
    };
    const findings = inspectComfyNodeGraph(bogus, OBJECT_INFO);
    const fail = findings.find((f) => f.level === "fail");
    expect(fail?.id).toBe("class:1");
    expect(fail?.message).toContain("LoadImageBase64");
    expect(fail?.hint).toContain("自定义节点");
  });

  it("输入名不存在 → fail 并在 expected 里列出该节点真实可用的输入名", () => {
    const wrong: ComfyWorkflow = {
      "2": { class_type: "LoadImageMask", inputs: { upload: "m.png", channel: "red" } },
    };
    const findings = inspectComfyNodeGraph(wrong, OBJECT_INFO);
    const fail = findings.find((f) => f.level === "fail" && f.id === "input:2.upload");
    expect(fail).toBeTruthy();
    // 约定：expected = 该节点真实可用的输入名；actual = 我写错的
    expect(fail?.expected).toContain("channel");
    expect(fail?.expected).toContain("image");
    expect(fail?.actual).toBe("upload");
  });

  it("combo 值不在允许列表 → fail 并列出可用值（channel 语义就在这一步暴露）", () => {
    const bad: ComfyWorkflow = {
      "2": { class_type: "LoadImageMask", inputs: { image: "m.png", channel: "luminance" } },
    };
    const findings = inspectComfyNodeGraph(bad, OBJECT_INFO);
    const fail = findings.find((f) => f.level === "fail" && f.id === "combo:2.channel");
    expect(fail?.expected).toContain("alpha");
    expect(fail?.actual).toContain("luminance");
  });

  it("ckpt_name 不在本机模型列表 → fail 并列出可用 checkpoint", () => {
    const bad: ComfyWorkflow = {
      "3": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "not-installed.safetensors" },
      },
    };
    const findings = inspectComfyNodeGraph(bad, OBJECT_INFO);
    const fail = findings.find((f) => f.id === "combo:3.ckpt_name");
    expect(fail?.level).toBe("fail");
    expect(fail?.message).toContain("模型");
    expect(fail?.expected).toContain("v1-5-pruned-emaonly.safetensors");
  });

  it("连线指向不存在的节点 → fail", () => {
    const bad: ComfyWorkflow = {
      "4": {
        class_type: "VAEEncodeForInpaint",
        inputs: { pixels: ["99", 0], vae: ["3", 2], mask: ["2", 0], grow_mask_by: 6 },
      },
    };
    const findings = inspectComfyNodeGraph(bad, OBJECT_INFO);
    const fail = findings.find((f) => f.id === "link:4.pixels");
    expect(fail?.level).toBe("fail");
    expect(fail?.actual).toContain("99");
  });
});

describe("getAvailableCheckpoints / inspectUploadResponse / summarize", () => {
  it("从 object_info 列出可用 checkpoint", () => {
    expect(getAvailableCheckpoints(OBJECT_INFO)).toEqual([
      "sd_xl_base_1.0.safetensors",
      "v1-5-pruned-emaonly.safetensors",
    ]);
    expect(getAvailableCheckpoints({})).toEqual([]);
  });

  it("上传响应形状：标准回复 ok，缺 name 给 warn（回落到本地文件名）", () => {
    expect(inspectUploadResponse({ name: "a.png", subfolder: "", type: "input" }).level).toBe("ok");
    expect(inspectUploadResponse({}).level).toBe("warn");
    expect(inspectUploadResponse(null).level).toBe("fail");
  });

  it("汇总与排序：fail 优先", () => {
    const findings = inspectComfyNodeGraph(
      { "1": { class_type: "Nope", inputs: {} } },
      OBJECT_INFO,
    );
    const summary = summarizeFindings(findings);
    expect(summary.fail).toBeGreaterThan(0);
    expect(rankFindings(findings)[0].level).toBe("fail");
  });
});

/* ── 文生图最小流程的 /object_info（含 EmptyLatentImage） ── */

const TXT2IMG_INFO: ComfyObjectInfo = {
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: [["sd_xl_base_1.0.safetensors", "v1-5-pruned-emaonly.safetensors"]],
      },
    },
  },
  CLIPTextEncode: {
    input: { required: { text: ["STRING", { multiline: true }], clip: ["CLIP"] } },
  },
  EmptyLatentImage: {
    input: {
      required: {
        width: ["INT", { default: 512, min: 16, max: 16384 }],
        height: ["INT", { default: 512, min: 16, max: 16384 }],
        batch_size: ["INT", { default: 1, min: 1, max: 4096 }],
      },
    },
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
  },
  VAEDecode: { input: { required: { samples: ["LATENT"], vae: ["VAE"] } } },
  SaveImage: {
    input: { required: { images: ["IMAGE"], filename_prefix: ["STRING", { default: "ComfyUI" }] } },
  },
};

const TXT2IMG_REQUIRED_NODES = [
  "CheckpointLoaderSimple",
  "CLIPTextEncode",
  "EmptyLatentImage",
  "KSampler",
  "VAEDecode",
  "SaveImage",
];

describe("inspectComfyNodeGraph：required 缺失 / 参数类型 / 必要节点", () => {
  it("最小文生图 workflow 对实例应无 fail", () => {
    const wf = buildTxt2ImgWorkflow({ prompt: "一只猫" });
    const findings = inspectComfyNodeGraph(wf, TXT2IMG_INFO, {
      requireNodes: TXT2IMG_REQUIRED_NODES,
    });
    expect(findings.filter((f) => f.level === "fail")).toEqual([]);
  });

  it("缺失 required 输入：无默认值 → fail，有默认值 → warn", () => {
    const noDefault: ComfyWorkflow = {
      "1": { class_type: "CLIPTextEncode", inputs: { text: "x" } }, // 缺 clip（无默认）
    };
    const f1 = inspectComfyNodeGraph(noDefault, TXT2IMG_INFO);
    expect(f1.find((f) => f.id === "required:1.clip")?.level).toBe("fail");

    const withDefault: ComfyWorkflow = {
      "4": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } }, // 缺 batch_size（有默认）
    };
    const f2 = inspectComfyNodeGraph(withDefault, TXT2IMG_INFO);
    expect(f2.find((f) => f.id === "required:4.batch_size")?.level).toBe("warn");
  });

  it("参数类型不匹配：INT 传字符串 → fail；张量输入传常量 → fail", () => {
    const badInt: ComfyWorkflow = {
      "4": { class_type: "EmptyLatentImage", inputs: { width: "512", height: 512, batch_size: 1 } },
    };
    const f = inspectComfyNodeGraph(badInt, TXT2IMG_INFO);
    expect(f.find((x) => x.id === "type:4.width")?.level).toBe("fail");

    const badTensor: ComfyWorkflow = {
      "6": { class_type: "VAEDecode", inputs: { samples: "not-a-link", vae: "not-a-link" } },
    };
    const f2 = inspectComfyNodeGraph(badTensor, TXT2IMG_INFO);
    expect(f2.find((x) => x.id === "type:6.samples")?.level).toBe("fail");
  });

  it("必要节点缺失 → fail 并点名", () => {
    const partial: ComfyWorkflow = buildTxt2ImgWorkflow({ prompt: "x" });
    delete partial["4"]; // 拿掉 EmptyLatentImage
    const f = inspectComfyNodeGraph(partial, TXT2IMG_INFO, {
      requireNodes: ["CheckpointLoaderSimple", "EmptyLatentImage", "KSampler"],
    });
    expect(f.find((x) => x.id === "missing-class:EmptyLatentImage")?.level).toBe("fail");
  });
});

describe("renderWorkflowReport：[PASS]/[ERROR] 节点级报告", () => {
  it("全绿：逐节点 PASS + Workflow validation: PASS", () => {
    const wf = buildTxt2ImgWorkflow({ prompt: "一只猫" });
    const { text, verdict } = renderWorkflowReport(wf, TXT2IMG_INFO, {
      requireNodes: TXT2IMG_REQUIRED_NODES,
    });
    expect(text).toContain("[PASS] CheckpointLoaderSimple");
    expect(text).toContain("[PASS] EmptyLatentImage");
    expect(text).toContain("[PASS] KSampler");
    expect(text).toContain("Workflow validation: PASS");
    expect(verdict).toBe("pass");
  });

  it("出错：打印 [ERROR] + input/value/reason/allowed 与 FAIL 结论", () => {
    const bad = buildTxt2ImgWorkflow({
      prompt: "一只猫",
      samplerName: "xxx",
      scheduler: "yyy",
    });
    const { text, verdict } = renderWorkflowReport(bad, TXT2IMG_INFO);
    expect(text).toContain("[ERROR] KSampler");
    expect(text).toContain("input: sampler_name");
    expect(text).toContain("reason: invalid enum value");
    expect(text).toMatch(/allowed:.*euler/);
    expect(text).toContain("Workflow validation: FAIL");
    expect(verdict).toBe("blocked");
  });
});
