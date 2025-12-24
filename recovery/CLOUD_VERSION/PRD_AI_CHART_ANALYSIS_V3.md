# AI 图表分析 V3（投产方案）

## 1. 背景与问题

当前 V2 的“AI 推荐图表 / 字段表 / 图表配置”容易出现以下问题：

- 不同笔记本最终推荐结果趋同（例如总是“时间 + AI评分”的折线）。
- 字段候选很多时，纯规则会选到“技术可用但语义不对”的字段（如 `created_at` vs `发布时间`）。
- 图表可读性与稳定性缺少工程级门槛（类别过多、稀疏热力图、折线点数过少等）。
- LLM 能力越权风险（直接输出图表配置、输出不受控字段/枚举）。

本方案将 LLM 的职责收敛到“高价值、低确定性决策”（语义→视角/字段计划、字段择优、字段生成），将“高确定性部分”交给代码侧（约束校验、映射、聚合、质量门槛、渲染）。

## 2. 目标与非目标

### 目标
- **先选最值得先看的视角**（一张最佳图），再补字段，再配置图表。
- 支持两阶段：**推荐模式**（AI选图/问题）与 **配置模式**（用户选图后只配置，不否定不替换）。
- 只允许四种图表：`line` / `bar` / `pie` / `heatmap`。
- 引入工程兜底：
  - **C1.5 字段择优（Rerank）**（优先级：高）
  - **质量门槛 Gates**（优先级：最高）
  - **三段式 Prompt 编排**（优先级：高）
- 引入“few-shot 口子两层 + policy_overrides 控制”以支持低成本灰度与逐步积累样本。

### 非目标
- 不做任意图表类型扩展（不支持散点、雷达、词云等）。
- 不做通用 BI（本方案面向“内容理解驱动分析”，不是字段报表工具）。

## 3. 核心约束（强制）
- 图表类型：只能是 `line | bar | pie | heatmap`。
- 推荐模式：LLM **不得**输出最终 `chart_config`（防越权）。
- 配置模式：LLM **不得**改变用户已选图表类型（不否定、不替换）。
- 若存在 `fixed_vocabularies`：分类字段输出必须从固定枚举中选择，不得新增类别。
- 最终 `chart_config` 由代码生成并校验，LLM 仅提供“建议/排序/字段值”。

## 4. 端到端流程（状态机）

### 4.1 模式判定
- `mode=recommend`：用户未选图表 → 选“核心问题 + 最佳图表 + 字段计划”。
- `mode=config`：用户已选图表（或点击“使用此图”）→ 只做字段择优 + 补字段 + 生成配置。

### 4.2 推荐模式（Prompt 1）
1. 输入：字段清单（模板字段+系统字段）+ 笔记样本（title/excerpt/created_at）+ 语义画像（轻量统计）+ policy + exemplars。
2. LLM 输出：`core_question + chart_type + field_plan(候选化) + missing_fields + confidence`。
3. 代码侧：执行校验与修正（B3），进入 Gates 判定；若失败则回退到规则推荐。

### 4.3 配置模式（Prompt 1.5 可选 + Prompt 2）
1. C1：若 `missing_fields` 非空 → 进入字段生成（Prompt 2）。
2. **C1.5（优先做）字段择优/Rerank（可选调用）**：
   - 输入：`chart_type + 字段候选列表 + 样本分布统计 + 语义画像 + policy + exemplars_config`
   - 输出：仅 `selected_fields`（不产值、不改图表类型）
   - 触发条件：候选冲突/规则评分低/并列时才启用（控成本）。
3. C2：代码侧生成最终 `chart_config`（映射规则固化），并再次通过 Gates 过滤/降级。

## 5. 数据输入与统一字段宇宙

### 5.1 字段来源
- Notebook 模板字段：`component_config.componentInstances`（字段名、组件类型）
- 系统字段：`created_at / updated_at / source / author / ...`
- AI 字段：
  - 推荐/配置阶段的 `missing_fields` 定义
  - Prompt 2 输出的 `field_values`

### 5.2 字段规范（FieldDefinition）
每个字段统一成：
```json
{
  "name": "字段名",
  "role": "dimension|metric",
  "data_type": "date|number|category|text",
  "source": "notebook|system|ai",
  "example": "样例值(可选)"
}
```

## 6. 质量门槛 Gates（优先做）
代码侧在“推荐”和“配置”阶段都执行 Gates，用于可读性与稳定性。

### 6.1 统计指标（由代码计算）
- 缺失率：`missing_rate(field) = missing_count / total`
- 分类基数：`cardinality(field)`
- topN 占比：`top_share = max(category_count)/total`
- 折线有效点数：按粒度聚合后 `point_count`
- 热力稀疏度：`non_empty_cells / total_cells`

### 6.2 Gate 规则（默认建议）
- 任何候选字段：缺失率 > 0.4 → 不参与选择
- 饼图：
  - 类别数 > 8 → 改 `bar`（TopN + “其他”）
  - 若 类别数 > 12 且 top_share < 0.15 → 改 `bar`
- 折线图：
  - 点数 < 5：自动降粒度 `day→week→month`；仍 < 5 则改 `bar`（按周/月对比）
- 热力图：
  - 稀疏度 < 0.1：不推荐热力图，改 `bar`（选其中一个维度做 TopN）
- 柱状图：
  - 类别数 > 30：强制 TopN + “其他”

以上阈值均可由 `policy_overrides.gates` 覆盖。

## 7. Prompt 编排（优先做：三段式）

### 7.1 Prompt 1（推荐）
输出只允许这些字段（禁止 chart_config）：
```json
{
  "mode": "recommend",
  "core_question": "string",
  "chart_type": "line|bar|pie|heatmap",
  "field_plan": {
    "time_field_candidates": [{"name":"", "score":0, "why":""}],
    "dimension_candidates": [{"name":"", "score":0, "why":""}],
    "metric_candidates": [{"name":"", "score":0, "why":""}],
    "selected": {"time_field":"", "dimension":"", "metric":""},
    "aggregation": "count|sum|avg|none",
    "time_granularity": "day|week|month|none",
    "missing_fields": [
      {
        "name": "",
        "role": "dimension|metric",
        "data_type": "category|number|date",
        "meaning": "",
        "range_or_values": "",
        "generate_from": ["title","content_text","某字段名"],
        "explain_template": "可选：用于 UI tooltip"
      }
    ]
  },
  "confidence": 0.0
}
```

### 7.2 Prompt 1.5（配置字段择优 / Rerank，可选调用）
```json
{
  "mode": "config_rerank",
  "chart_type": "line|bar|pie|heatmap",
  "selected_fields": {
    "time_field": "string|optional",
    "dimension_field": "string|optional",
    "dimension_field_2": "string|optional",
    "metric_field": "string|optional",
    "aggregation": "count|sum|avg|none",
    "time_granularity": "day|week|month|none"
  },
  "why": "string",
  "confidence": 0.0
}
```
强约束：只能从候选列表里选；不得产值；不得改图。

### 7.3 Prompt 2（字段生成）
```json
{
  "mode": "derive_fields",
  "field_values": {
    "字段名A": { "note_id_1": "值", "note_id_2": "值" }
  },
  "evidence": {
    "字段名A": { "note_id_1": "关键词/短证据(可选)" }
  }
}
```

## 8. Few-shot 口子（两层）+ 固定枚举 + policy 控制

### 8.1 配置结构
- `EXEMPLARS_RECOMMEND[]`：推荐模式 few-shot
- `EXEMPLARS_CONFIG[]`：配置模式（字段择优）few-shot
- `EXEMPLARS_DERIVE_FIELDS[]`：字段生成 few-shot
- `POLICY_OVERRIDES`：强控制
- `FIXED_VOCABULARIES`：固定枚举（也可并入 policy）

### 8.2 注入策略
- 推荐模式：按“语义画像”选 top 2–3 条 `EXEMPLARS_RECOMMEND` 注入 Prompt 1
- 配置模式：按 chart_type + 语义画像选 top 1–2 条 `EXEMPLARS_CONFIG` 注入 Prompt 1.5
- 字段生成：注入 1 条 `EXEMPLARS_DERIVE_FIELDS` + 强制 `FIXED_VOCABULARIES`

### 8.3 policy_overrides（示例）
```json
{
  "policy_overrides": {
    "default_core_question_by_scene": {
      "content_collection": "topic_distribution",
      "mood": "mood_distribution",
      "fitness": "frequency_trend",
      "accounting": "spend_distribution"
    },
    "fixed_vocabularies": {
      "主题": ["模型","工具","应用","行业","研究","其他"],
      "情绪来源": ["工作","家庭","朋友","健康","金钱","自我成长","其他"]
    },
    "field_name_preferences": {
      "time": ["发布时间","日期","created_at"],
      "topic": ["主题","标签","关键词"]
    },
    "gates": {
      "pie_topn": 8,
      "line_min_points": 5,
      "heatmap_min_density": 0.1,
      "field_max_missing_rate": 0.4,
      "bar_max_categories": 30
    }
  }
}
```

## 9. 回退策略（必备）
- 若 Prompt 1 输出不符合 schema / chart_type 非法 / 字段缺失严重：
  - 回退到纯规则（字段驱动）推荐
- 若 Prompt 1.5 未启用或失败：
  - 用规则评分选字段（按缺失率、基数、偏好字段名排序）
- 若 Prompt 2 生成字段失败：
  - 退化为 `count` 指标（只做频次），并在 UI 给出提示

## 10. 投产计划（按优先级）
### 优先级：1、5、6（先做）
1) 配置模式字段择优 rerank（Prompt 1.5，条件触发）  
5) 代码侧 Gates（可读性/稳定性门槛）  
6) 三段式 Prompt 编排（1/1.5/2）  

### 其次：2、3、4（后做）
2) field_plan 候选化 + 置信度（提升修正自然度）  
3) explain_template + evidence（增强可解释性，注意隐私与成本）  
4) 核心问题选择器（统一“为什么这张图最值得看”的叙事）  

## 11. 验收标准（最小可投产）
- 不同笔记本在内容语义差异明显时，推荐图表类型与核心问题可明显不同。
- 任意输出都满足四图限制与 schema，且 chart_config 永远由代码生成。
- gates 生效：饼图/热力图/折线在不可读时能自动降级为可读图表。
- 字段择优生效：同图表类型下能避免选到语义不对的字段（如发布时间优先于 created_at）。

