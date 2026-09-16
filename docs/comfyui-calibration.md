# ComfyUI 对接校准清单

> 写给「装好 ComfyUI 之后」的那一步。`lib\canvas\comfy-bridge.ts` 的 inpaint 节点图是**按 API 文档手写**的、
> 从未对过真实实例（本机无 ComfyUI）。这份清单把「要核的每一件事」列出来，并把它做成**可机械核验** ——
> 靠的是 ComfyUI 自己的自省接口 `GET /object_info`（返回每个节点的真实输入名、类型与可选值）。

---

## 一、三条命令

```bash
# ① 不装 ComfyUI 也能先看到整条链路（本仓自带的假实例，只回占位图，不生成真图）
npm run stub:comfy          # 监听 8188
npm run dev                 # 另开一个终端
#   打开 /canvas → 粘贴一张图（Ctrl+V）→ 选中它 → 填 Prompt → 点「✨ ComfyUI Inpaint」
#   预期：按钮文案 连接中… → 生成中…，进度 0→25→50→75→100%，
#        画布上多出一张结果图（落在**原选区坐标与尺寸**上）

# ② 装好真 ComfyUI 后，跑校准（这是本清单的主体）
python main.py --enable-cors-header     # --enable-cors-header 不是可选的，见第四节
npm run comfy:doctor                    # 逐项比对；有 fail 就 exit 1

# ③ 想看「本仓到底会发什么」时
npm run comfy:doctor -- --dump          # 打印将发送的 API 格式 workflow JSON
npm run comfy:doctor -- --url=http://127.0.0.1:8288    # 换端口
```

`comfy:doctor` **不改任何文件、不生成图**，只告诉你「哪里对不上、该改成什么」。

---

## 二、doctor 会自动核的项

| # | 要核的东西 | 为什么它可能出错 | 对不上时改哪 |
|---|---|---|---|
| 1 | 8 个节点类是否存在 | 自定义节点缺失 / 类名拼写不同 | 报错会点名；内置 inpaint 链路不需要自定义节点 |
| 2 | 每个输入名是否存在 | 我按文档写，版本间可能改名 | 报错会**列出该节点真实可用的输入名** |
| 3 | `LoadImageMask.channel` 的合法值 | W30 写的 `"red"` 是猜的（合法值可能是 `alpha`） | 报错会列出允许值 |
| 4 | **`CheckpointLoaderSimple.ckpt_name` 必须是本机已有模型** | 这是**最常见的一处失配**：本仓默认 `sd_xl_base_1.0.safetensors`，多数人装的是 `v1-5-pruned-emaonly.safetensors` | 报错会列出本机模型；改 `DEFAULT_CHECKPOINT` 或传 `COMFY_CHECKPOINT=<名>` |
| 5 | `KSampler.sampler_name` / `scheduler` 的合法值 | 同上，采样子集随版本不同 | 报错会列出允许值 |
| 6 | 连线指向的节点是否存在 | 我手工写的节点 id | 报错会列出图内实际 id |
| 7 | `POST /upload/image` 的响应形状 | 不同版本/反代可能把文件名放别的字段 | 无 `name` 会 warn（本仓会回落到本地文件名） |
| 8 | `VAEEncodeForInpaint.grow_mask_by` 的取值范围 | 影响接缝，超出范围会被后端拒 | 报错会列出 min/max |

跑一次真实输出长这样（对着本仓的 stub 实例，故意用错 checkpoint）：

```
✓ [probe] 实例可达（ComfyUI stub-0.1.0）
✓ [checkpoints] 本机模型：v1-5-pruned-emaonly.safetensors
✗ [combo:3.ckpt_name] CheckpointLoaderSimple.ckpt_name 指向的**模型**不在本机模型列表里
    期望: v1-5-pruned-emaonly.safetensors
    实际: sd_xl_base_1.0.safetensors
    建议: 这是最常见的一处对不上：把本仓的 checkpoint 默认值改成上面列出的本机模型文件名
? [manual:1.image] LoadImage.image 需要的是**已上传到 input 目录的文件名**
    实际: comfy-doctor.png
    建议: 本仓先 POST /upload/image 拿到 name，再把这个 name 填进来（不能塞 base64）

── 汇总 ──
  ✓ 23  ok   ! 0  warn   ✗ 1  fail   ? 2  manual
结论：**对不上**。按上面的「建议」逐条改，再跑一次；全绿后即可在 /canvas 里点 ComfyUI Inpaint。
```

---

## 三、机器核不了、只能人工看一眼的两项（doctor 标 `manual`）

1. **`image` 输入必须是「已上传到 input 目录的文件名」**，不是图像数据。本仓的实现是「先 `POST /upload/image` 拿 name，再建 workflow」——doctor 只能提醒，不能替你确认上传真的落盘。
2. **结果图能否取回**：`GET /view?filename=…&subfolder=…&type=output` 的 URL 形状。浏览器里跑一次 inpaint，看画布上是否真的出现图片即可（W32 用 stub 验过这条链路是通的）。

---

## 四、硬要求（踩过才知道）

- **CORS 是必需的，不是可选的。** 页面跑在 `localhost:3000/3100`，ComfyUI 在 `127.0.0.1:8188` —— **跨源**。缺 `--enable-cors-header` 时浏览器侧表现为 `Failed to fetch`（W32 实测，一度误以为是代码 bug）。
- 另外 `/prompt` 发的是 `application/json`（非 CORS safelisted 类型），浏览器会先发 **OPTIONS 预检**；ComfyUI 必须能应答预检，否则同样 `Failed to fetch`。
- **checkpoint 必须先放好**（`ComfyUI/models/checkpoints/`），否则第 4 项必红。
- 首次对接建议**先只跑一张小图**（512×512 以内）确认链路，再谈参数调优。
- `LoadImageMask` 用的是遮罩图的 **red 通道**（本仓 `channel: "red"`）；本仓生成的遮罩是纯白 PNG，因此任何通道等价 —— 但若你用别的遮罩来源，先确认通道语义。

---

## 五、「最小可跑 Workflow」模板

本仓的 **9 节点图就是最小可跑集**：

```
LoadImage ─┐
LoadImageMask ─┐
CheckpointLoaderSimple ─┬─→ VAEEncodeForInpaint ─→ KSampler ─→ VAEDecode ─→ SaveImage
CLIPTextEncode(正向) ────┤                            ↑
CLIPTextEncode(负向) ────┘                            └── latent_image
```

两种用法：

1. **看本仓会发什么**：`npm run comfy:doctor -- --dump`
2. **与 WebUI 手工成果对照**（最有效的一步）：
   - 在 ComfyUI WebUI 里手工搭一条 inpaint 并**真的跑通**
   - 菜单里切到 **API Format**，导出 JSON
   - 与 `--dump` 的输出逐节点对比 `class_type` 与输入名
   - **有任何差异就把差异贴出来** —— 我按真实契约改代码，而不是继续猜

> 为什么不去猜：W30 把 base64 塞进 `LoadImage.image`（真实契约要的是文件名），
> W31 才发现并改成「先上传再引用」。这类错误只有对着真实例才能消除，所以这份清单的重点是**把可机械核的部分交给机器**。
