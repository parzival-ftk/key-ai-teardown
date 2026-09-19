# ComfyUI 模型选型实验（阶段 14）

> 回答两个问题：**A) 阶段 13 观察到的 `dpmpp_2m` 主体改善是否可重复？** **B) 当前 SD1.5 基座是否主要瓶颈？**
> 全部为真实 ComfyUI 生成（0.34.0 / torch 2.14.0+cu130 / RTX 3060 Laptop 6GB），走 `ComfyUIProvider`。
> 评价方式：人工视觉判读（**未引入任何 AI 评分模型**），标签 `subject_hit / scene_hit / attribute_hit / composition_hit`。

---

## 1. Experiment design

```text
Prompts:      5（固定测试集 case-01 … case-05，与阶段 13 相同）
Seeds:        123456 / 234567 / 345678 / 456789 / 567890
Steps:        20
CFG:          7.5
Scheduler:    normal
Resolution:   512×512
Denoise:      1.0

实验组：
  exp1-euler      SD1.5 base × euler     × 5 seeds × 5 cases = 25
  exp1-dpmpp2m    SD1.5 base × dpmpp_2m  × 5 seeds × 5 cases = 25
  exp2-rv51       RV5.1      × euler     × 5 seeds × 5 cases = 25

实际新生成：75 张（exp1 共 50 + exp2 共 25）
checkpoint 对照观测数：25 (SD1.5) vs 25 (RV5.1) = 50 个观测
```

关于 checkpoint 对照的样本说明：**SD1.5 那一组直接复用 `exp1-euler`**（prompt/seed/checkpoint/steps/cfg/sampler/scheduler/resolution 与模型对照要求逐项相同），因此未重复生成；RV5.1 组为新增 25 张。两组的 25 个观测全部为真实生成，非推导。

第二 checkpoint：

```text
名称:   Realistic_Vision_V5.1_fp16-no-ema.safetensors
来源:   https://huggingface.co/SG161222/Realistic_Vision_V5.1_noVAE
许可:   creativeml-openrail-m
格式:   单文件 safetensors（CheckpointLoaderSimple 可直接加载）
架构:   SD1.5 微调（写实向，明确用于 txt2img）
大小:   2,132,625,894 bytes（fp16，6GB VRAM 实测可跑）
```

---

## 2. Sampler comparison（均 SD1.5 base，各 25 张）

| Sampler | Total | Subject hit | Scene hit | Attribute hit | Composition hit |
|---|---|---|---|---|---|
| euler | 25 | **2/25** | 14/25 | 0/25 | 0/25 |
| dpmpp_2m | 25 | **3/25** | 14/25 | 0/25 | 0/25 |

按 case 展开（subject_hit）：

| case | euler | dpmpp_2m |
|---|---|---|
| case-01（猫/窗台） | 1/5 | 2/5 |
| case-02（橘猫/室内窗台/城市夜景） | 0/5 | 0/5 |
| case-03（木桌/红苹果/书） | 0/5 | 0/5 |
| case-04（黑夹克男人/雨夜街道） | 0/5 | 0/5 |
| case-05（白猫/室内暖光） | 1/5 | 1/5 |

**逐格对照观察（本阶段最硬的事实）**：同 seed 下 euler 与 dpmpp_2m 的输出**构图几乎逐格相同** —— case-02 两行都是同一组城市夜景、case-03 两行是同一组人群/婚礼、case-04 两行是同一组雨夜街道、case-05 两行是同一组室内。**只有 case-01 seed=123456 一格明显不同**（euler：棕黄色灵长类样动物；dpmpp_2m：虎斑猫）。

---

## 3. Checkpoint comparison（均 euler，各 25 张）

| Checkpoint | Total | Subject hit | Scene hit | Attribute hit | Composition hit |
|---|---|---|---|---|---|
| SD1.5 base (`v1-5-pruned-emaonly-fp16`) | 25 | **2/25** | 14/25 | 0/25 | 0/25 |
| RV5.1 (`Realistic_Vision_V5.1_fp16-no-ema`) | 25 | **8/25** | 12/25 | 0/25 | 0/25 |

按 case 展开（subject_hit / scene_hit）：

| case | SD1.5 subject | RV5.1 subject | SD1.5 scene | RV5.1 scene |
|---|---|---|---|---|
| case-01 | 1/5 | **5/5** | 0/5 | 0/5 |
| case-02 | 0/5 | 0/5 | 5/5 | 5/5 |
| case-03 | 0/5 | 0/5 | 0/5 | 0/5 |
| case-04 | 0/5 | **2/5** | 4/5 | 2/5 |
| case-05 | 1/5 | 1/5 | 5/5 | 5/5 |

---

## 4. Key evidence

支撑结论的最小证据集（完整 100 格判读见 `annotations-exp1.jsonl` / `annotations-exp2.jsonl`，原始 75 条生成记录见 `results.jsonl`）：

| case | seed | sampler | checkpoint | artifact | observation |
|---|---|---|---|---|---|
| case-01 | 123456 | euler | SD1.5 | `exp-exp1-euler-case-01-s123456_00001_.png` | 棕黄色灵长类样动物，丛林 |
| case-01 | 123456 | dpmpp_2m | SD1.5 | `exp-exp1-dpmpp2m-case-01-s123456_00001_.png` | **虎斑猫**（与上一格同 seed 不同 sampler，结果不同） |
| case-01 | 234567/345678/456789/567890 | euler vs dpmpp_2m | SD1.5 | `exp-exp1-{euler,dpmpp2m}-case-01-s*.png` | **四对逐格同构图**（山路黑狗 / 村落实景 / 人群柴犬 / 橘猫森林） |
| case-01 | 全部 5 seed | euler | RV5.1 | `exp-exp2-rv51-case-01-s*.png` | **5/5 全部是猫**（虎斑/灰/黑白，近景或室内） |
| case-04 | 345678 | euler | RV5.1 | `exp-exp2-rv51-case-04-s345678_00001_.png` | 穿黑色连帽夹克的人站在夜晚户外 |
| case-03 | 全部 5 seed | euler | RV5.1 | `exp-exp2-rv51-case-03-s*.png` | **全部是人物主体（其中多张为 NSFW 裸露内容）**，无桌/苹果/书 |
| case-02 | 全部 5 seed | euler | 两者 | `exp-exp1-euler-case-02-s*.png` / `exp-exp2-rv51-case-02-s*.png` | 两模型均 0/5 主体；场景 5/5（RV5.1 更贴「室内看窗外城市夜景」） |

---

## 5. Verified findings

1. **`dpmpp_2m` 在阶段 13 观察到的 case-01 改善，在 5 个 seed 上不可重复。** euler 2/25 → dpmpp_2m 3/25，**净增 1 张**，全部集中在 case-01 的单个 seed（123456）。其余 4 个 seed 在两种 sampler 下**逐格同构图**。
2. **sampler 的总体影响很小**：subject_hit 差异 +1/25；scene_hit 完全相同（14/25 vs 14/25）。
3. **checkpoint 的影响显著大于 sampler**：subject_hit 2/25 (8%) → 8/25 (32%)，**+6 张**；且跨 2 个 case（case-01 1→5，case-04 0→2）。
4. **改善高度集中在 case-01**：RV5.1 在 case-01 达 5/5，但 case-02 / case-03 两个模型都是 0/5。
5. **`scene_hit` 持续显著高于 `subject_hit`**（SD1.5：14/25 对 2/25；RV5.1：12/25 对 8/25）。两个模型都更擅长产出「像某个场景」，而非准确绑定 prompt 主体 —— 阶段 13 的模式在多 seed 下被确认。
6. **`attribute_hit` 与 `composition_hit` 在 100 格里全为 0**：没有任何一张同时满足「主体正确 + 关键属性正确（橘猫/红苹果/黑色夹克/白色）+ 关系成立（猫坐在窗台上）」。
7. **RV5.1 有明确的模型偏好副作用**：在 case-03（无人物 prompt）上 5/5 生成人物主体（含 NSFW 裸露内容）—— 该模型是写实人像向微调，对非人物 prompt 会跑偏。**这是选型时必须计入的成本，不只是 subject_hit 的数字。**

---

## 6. Hypotheses（未充分验证，不作为结论）

1. 「SD1.5 基座是主要瓶颈」得到**方向性支持**（换模型 subject_hit ×4），但只有 2 个 checkpoint、5 个 prompt、25 seed-样本/组，**不足以断言这是唯一或最大瓶颈**。
2. case-02 / case-03 的 0/5 可能是 **prompt 表达方式**（中文、复合主体、无人物）而非模型能力问题 —— 需 prompt 改写对照才能区分。
3. RV5.1 在 case-01 的 5/5 是否代表「整体主体遵循能力更强」，还是仅仅「更倾向生成动物/人」—— 需要用**同域 prompt**（如纯风景 prompt）交叉验证。
4. seed 的影响显著大于 sampler，但本阶段未做「同 sampler 多 seed」的方差量化（那是另一组实验）。

---

## 7. Reproducibility

```text
参数一致性: 同组内 prompt/seed/checkpoint/steps/cfg/sampler/scheduler/resolution 逐项相同
seed 使用:  5 个固定 seed，跨 sampler / checkpoint 对齐使用（同 seed 可比）
bytes/hash: 同参数重跑字节不一致（差 3 字节级），sha256 不同 —— 与阶段 13 结论一致，未判为错误
视觉一致性: 同参数同 seed 的两组输出在肉眼上高度一致（本阶段同 seed 跨 sampler 的逐格同构图即为直接证据）
```

---

## 8. Tests

```text
lint:       PASS (0 problems)
typecheck:  PASS (exit 0)
unit:       1025 passed / 102 files
experiment: 75/75 次真实生成成功（exp1 50 + exp2 25），0 失败
live E2E:   未在本阶段重跑（生成走的是同一 ComfyUIProvider 真实链路；本阶段新增的批量路径由 75/75 成功率覆盖）
```

---

## 9. Git

```text
Files changed:
  scripts\comfy-experiment.ts   （扩展为批量：--cases / --seeds / --exp，filenamePrefix 含 case+seed）
  docs\comfyui-model-selection.md（本文件，新增）
Production code changes: NO
```

未改 Provider 架构、未改 `GenerationResult` 契约、未改 ComfyUI adapter。

---

## 10. 四个问题的回答

**Q1 — `dpmpp_2m` 的 case-01 改善是否在多个 seed 中重复出现？**
**没有。** 5 个 seed 中只有 seed=123456 一格出现差异；其余 4 个 seed 与 euler 逐格同构图。总体 2/25 → 3/25。（VERIFIED）

**Q2 — 若存在改善，是否扩展到其他 Prompt？**
**没有扩展。** dpmpp_2m 的 +1 全部来自 case-01；case-02/03/04/05 的 subject_hit 与 euler 完全相同。（VERIFIED）

**Q3 — 第二 checkpoint 是否显著改变 subject_hit_rate？**
**是。** SD1.5 2/25 (8%) → RV5.1 8/25 (32%)，净增 6 张、跨 2 个 case。但 scene_hit 反而略降（14/25 → 12/25），且 RV5.1 在无人物 prompt 上会跑偏生成人物（含 NSFW）。（VERIFIED）

**Q4 — 当前阶段最有证据支持的瓶颈是什么？**
**VERIFIED**：在已测范围内，**checkpoint（模型）对 subject_hit 的影响显著大于 sampler**（+6 vs +1，跨 case 数 2 vs 1）；且两个模型都表现出「场景对、主体错」的同一模式（scene_hit 远高于 subject_hit）。
**HYPOTHESIS**：模型是主要瓶颈，但受限于 2 个 checkpoint / 5 个 prompt / 25 样本每组，不能断言它是唯一瓶颈；prompt 表达方式、以及缺少属性/构图的进一步调优，都还未排除。

---

## 11. 复现方式

```bash
# 批量：cases × seeds 笛卡尔积
npm run comfy:experiment -- --cases=case-01,case-02 --seeds=123456,234567 \
  --sampler=euler --checkpoint=v1-5-pruned-emaonly-fp16.safetensors --exp=my-run

# 产物
.rivet/experiments/results.jsonl          # 机器记录（含 experimentId/case/seed/参数/bytes/sha256/artifact）
.rivet/experiments/annotations-*.jsonl    # 人工判读标签
.rivet/experiments/sheets/*.png           # 对照拼图（可复核）
```
