# ComfyUI 生成质量基线（阶段 13）

> 目的：在**当前** checkpoint + Provider + Workflow 不变的前提下，测量 Prompt 遵循度能做到什么程度。
> 本阶段**不改生产代码**，只建实验体系（CLI + 固定测试集 + 可追溯记录）并如实记录观察。
> 所有数字来自真实实例 `http://127.0.0.1:8188`（ComfyUI 0.34.0 / torch 2.14.0+cu130 / RTX 3060 Laptop 6GB）。

---

## 1. 当前基线参数（= 代码默认值，非节点默认值）

| 项 | 值 | 来源 |
|---|---|---|
| Checkpoint | `v1-5-pruned-emaonly-fp16.safetensors` | 实例 `/object_info` 的 `ckpt_name` 允许列表唯一项 |
| Steps | 20 | `comfy-bridge.ts` `DEFAULT_STEPS`（= 节点默认 20） |
| CFG | **7.5** | `comfy-bridge.ts` `DEFAULT_CFG`（**节点默认是 8.0**，本仓显式传 7.5） |
| Sampler | `euler` | `DEFAULT_SAMPLER` |
| Scheduler | `normal` | `DEFAULT_SCHEDULER` |
| Resolution | 512×512 | `DEFAULT_WIDTH` / `DEFAULT_HEIGHT` |
| Denoise | 1.0 | `DEFAULT_TXT2IMG_DENOISE` |
| Seed | **123456**（实验固定） | 实验 CLI 默认 |

真实 `/object_info` 可选值：`sampler_name` 45 项、`scheduler` 9 项（`simple, sgm_uniform, karras, exponential, ddim_uniform, beta, normal, linear_quadratic, kl_optimal`）。

---

## 2. 固定测试集（5 个，写死在 `scripts\comfy-experiment.ts`）

| id | prompt |
|---|---|
| case-01 | 一只坐在窗台上的猫 |
| case-02 | 一只橘猫坐在室内窗台上，窗外是城市夜景 |
| case-03 | 一张木桌上放着一个红色苹果和一本打开的书 |
| case-04 | 一个穿黑色夹克的男人站在雨夜街道上 |
| case-05 | 一只白色猫咪，室内暖光，电影感摄影 |

---

## 3. 实验设计与结果

单变量原则：除 `Changed variable` 一列外，其余全部锁定为基线；全部 `seed=123456`。

| Exp | Changed variable | Before | After | Result（视觉观察） |
|---|---|---|---|---|
| A | —（基线） | — | steps20 / cfg7.5 / euler / normal | 见下 case-01 行 |
| B | steps | 20 | **30** | 主体仍是棕黄色灵长类样动物；**背景新增两只猫**（左一、右一）；主体未纠正 |
| C | cfg | 7.5 | **10** | 主体仍是棕黄色动物；构图略变；无猫出现 |
| D | sampler | euler | **dpmpp_2m** | **主体变成一只虎斑猫特写**（猫耳/猫脸/胡须清晰）——本轮唯一主体命中 |
| E | scheduler | normal | **karras** | 主体仍是棕黄色动物，与基线高度相似 |

### 基线 5 个 case 的观察（A）

| case | prompt 核心要素 | 实际画面 | 遵循度 |
|---|---|---|---|
| case-01 | 猫 / 窗台 | 一只棕黄色灵长类样动物，户外丛林 | **不符**（主体错、场景错） |
| case-02 | 橘猫 / 室内窗台 / 城市夜景 | 俯视城市夜景（街道、路灯、楼） | 部分（场景对，**无主体**） |
| case-03 | 木桌 / 红苹果 / 打开的书 | 室内一群白服人群（似聚会） | **不符**（三个要素全无） |
| case-04 | 黑色夹克男人 / 雨夜街道 | 夜空下的树影剪影 | **不符**（无人物、无街道） |
| case-05 | 白色猫咪 / 室内暖光 | 室内餐厅客厅（餐桌椅、暖光） | 部分（氛围对，**无主体**） |

---

## 4. Evidence（每组可追溯）

产物目录：`.rivet\experiments\images\`；机器可读记录：`.rivet\experiments\results.jsonl`；拼图存证：`.rivet\experiments\contact-sheet.png`。

| tag | case | seed | steps | cfg | sampler/scheduler | bytes | sha256(前16) | artifact |
|---|---|---|---|---|---|---|---|---|
| baseline-case-01 | case-01 | 123456 | 20 | 7.5 | euler/normal | 557939 | `d5066a26b3b1c261` | `exp-baseline-case-01_00001_.png` |
| baseline-case-02 | case-02 | 123456 | 20 | 7.5 | euler/normal | 479008 | `7385ec045582ff97` | `exp-baseline-case-02_00001_.png` |
| baseline-case-03 | case-03 | 123456 | 20 | 7.5 | euler/normal | 439584 | `cf3e46368cfe9046` | `exp-baseline-case-03_00001_.png` |
| baseline-case-04 | case-04 | 123456 | 20 | 7.5 | euler/normal | 422852 | `3fc6c6d9a78d9bce` | `exp-baseline-case-04_00001_.png` |
| baseline-case-05 | case-05 | 123456 | 20 | 7.5 | euler/normal | 360902 | `ea533f045c5e0731` | `exp-baseline-case-05_00001_.png` |
| expB-steps30 | case-01 | 123456 | **30** | 7.5 | euler/normal | 568029 | `fbccfa4213d485a9` | `exp-expB-steps30_00001_.png` |
| expC-cfg10 | case-01 | 123456 | 20 | **10** | euler/normal | 554901 | `94af325ddb66c61c` | `exp-expC-cfg10_00001_.png` |
| expD-dpmpp2m | case-01 | 123456 | 20 | 7.5 | **dpmpp_2m**/normal | 581052 | `6839579b4e20bb20` | `exp-expD-dpmpp2m_00001_.png` |
| expE-karras | case-01 | 123456 | 20 | 7.5 | euler/**karras** | 559146 | `3095549ba6ab5dc6` | `exp-expE-karras_00001_.png` |
| repro-case-01 | case-01 | 123456 | 20 | 7.5 | euler/normal | 557936 | `e307f87ea1e91b35` | `exp-repro-case-01_00001_.png` |

---

## 5. 可重复性

同 Prompt / 同 seed / 同 checkpoint / 同全部参数，跑两次：

```text
Run 1 (baseline-case-01): bytes=557939  sha256=d5066a26b3b1c261…
Run 2 (repro-case-01)   : bytes=557936  sha256=e307f87ea1e91b35…
Result: 字节不一致（差 3 字节），sha256 不同；但两张图**肉眼高度一致**（同主体、同姿势、同构图）
```

结论：**当前环境不是字节级确定性的**。这是如实记录的行为，不是"系统有 bug"的结论。可能来源（**待验证假设**）：GPU 浮点归约顺序 / cuDNN 非确定性算法 / 采样器内部并行归约。对"人工看图"用途无影响；对"逐字节复现"用途则有影响。

---

## 6. Conclusion

### VERIFIED FACTS（实测得到，可复核）

1. 在当前 checkpoint + 基线参数 + seed=123456 下，**5 个固定 case 无一正确渲染出 prompt 的核心主体**（猫 / 桌+苹果+书 / 男人）。
2. 5 个 case 中 2 个命中了 prompt 的**场景/氛围**要素（case-02 城市夜景、case-05 室内暖光），但主体缺失。
3. 单变量对照中：`steps 20→30` 与 `cfg 7.5→10` 与 `scheduler normal→karras` **都没有纠正 case-01 的主体**；`sampler euler→dpmpp_2m` **在本例中使主体从「棕黄色灵长类样动物」变为「虎斑猫」**。
4. **字节级不可复现**（同参数两次 sha256 不同，差 3 字节），但视觉高度一致。
5. 每个配置只有 **n=1** 次采样。

### HYPOTHESES（**尚未验证，不要当成结论**）

1. `sampler` 可能对主体遵循度有显著影响 —— 目前只有 case-01 的单例观察，**需要多 seed 重复才能判定**。
2. **当前基座 SD1.5（无微调）的语义理解能力是主要瓶颈**，而非采样参数 —— 5/5 主体失败覆盖面较广，符合"模型能力上限"特征而非"参数调错"。
3. `steps`/`cfg`/`scheduler` 在 512×512、20 步区间对主体遵循度影响有限 —— 各仅 n=1，不足以下结论。

### 未做的事（按用户约束）

- 未引入 CLIP / VLM 评分模型（留待数据量足够后单独阶段）。
- 未更换 checkpoint（留待阶段 14）。
- 未按"感觉"调参后宣称"更好了"。

---

## 7. 复现方式

```bash
npm run comfy:experiment -- --list                       # 看固定测试集
npm run comfy:experiment -- --case=case-01 --tag=my-run  # 跑一次（固定 seed=123456、基线参数）
npm run comfy:experiment -- --case=case-01 --tag=steps-30 --steps=30   # 单变量
```

结果追加写入 `.rivet\experiments\results.jsonl`，图片落在 `.rivet\experiments\images\`。
