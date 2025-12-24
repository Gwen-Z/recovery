# /analysis/v2 PRD（按需生成 · 默认最佳图 + 最多 3 个候选）

## 1. 背景与问题
当前 /analysis/v2 主要依赖“字段表 + 拖拽轴位”的配置型流程，学习成本高、默认结果不稳定，也难体现 AI “一次解析 → 自动产出洞察与图表”的价值。

## 2. 产品目标
- **低门槛**：用户无需配置字段即可看到洞察与图表。
- **清晰结构**：固定输出 3 类洞察，最多 3 个图表候选，默认只显示最佳图。
- **可解释**：保留字段表/拖轴位作为“高级配置”，用于追溯 AI 思考与手动调整，但默认折叠。
- **成本可控**：图表和洞察基于一次分析结果；切换候选时按需渲染，不重复触发分析。

## 3. 范围与非目标
### 3.1 本期范围（MVP）
- 入口：`/analysis/v2/:notebookId?`
- 一次 AI 解析输出：3 条洞察 + 1~3 个图表候选（默认 1 个最佳图）。
- 图表区提供下拉/Tab 切换候选，切换后渲染对应图表并显示对应洞察。
- 高级配置区保留字段表/拖轴位/自定义字段，默认折叠，点击“高级配置”展开。

### 3.2 非目标
- 不要求用户创建/理解 schema。
- 不做 BI 级报表。
- 不强制给出行为建议（监控型仅提供观察视角）。

## 4. 核心原则
1) **不牺牲记录体验**：不要求用户额外字段。
2) **结构化只发生在分析期**：派生字段为临时信号，不回写主业务字段。
3) **先洞察，后图表**：洞察为主，图表为证据。
4) **按需可解释**：高级配置可追溯 AI 选字段逻辑，但默认不打扰。

## 5. 用户流程
1. 进入 `/analysis/v2` → 选择笔记本 + 时间窗（默认 7 天）。
2. 点击“分析/刷新” → AI 一次解析 → 返回洞察 + 候选图表（最多 3）。
3. 默认显示最佳图 + 对应洞察；用户可下拉切换到其他候选。
4. 若需追溯 AI 思考或手动调整 → 点击图表区右上角“高级配置”展开。

## 6. 页面结构（新）
### 6.1 顶部筛选区
- 笔记本选择、时间窗（7/30/90/自定义，默认 7 天）、笔记勾选、分析/刷新按钮。
- 显示：上次分析时间、缓存命中（可选）。

### 6.2 洞察卡区（默认展开）
固定 3 张卡（与图表候选联动切换），显示 coverage / confidence（小字）：
- **主要洞察**（`State`）：一句话主结论/概括核心情况（≤80 字），要求“像结论而不是描述”
- **变化趋势**（`Change`）：时间维度的变化/波动（≤80 字），要求“回答变在哪里而不是静态描述”
- **建议卡（关键改造）**（`Pattern`）：不再是“系统希望你做什么”，而是 AI 基于“当前洞察”从「用户目标视角」给出的下一步可能性（≤80 字）

#### 6.2.A 视觉层级与“重点突出”（UI 规范）
当前卡片“太平”的根因通常不是内容缺失，而是**信息层级没有被视觉层级承接**。为保证“读一眼就抓住重点”，卡片采用以下约束：

1) **标题级结论（首行更大）**
- 每张卡正文的首行视为“标题级结论”，字号/字重高于后续说明行。

2) **关键词高亮（局部强调，不整段加粗）**
- 模型输出中可用 `「…」` / `“…”` / `【…】` 包裹关键短语（主题/对象/阶段/对比点）。
- 前端对上述包裹内容做强调色或浅底高亮，避免整段加粗导致“无重点”。

3) **对比锚点单独成行（变化趋势卡）**
- 变化趋势必须包含对比锚点（`相比…`），并在 UI 上单独成行呈现（例如左侧细竖线），形成可扫读的时间纵深。

4) **建议列表样式（第三卡）**
- 第三卡建议允许出现 1–2 条编号（`1.`/`2.`），前端渲染为列表样式（编号胶囊 + 单行），提升可执行性与可读性。

5) **右上角标签（提示阅读目的）**
- 每张卡右上角展示一个轻量标签（pill），分别为：`结论` / `对比` / `下一步`，帮助用户快速建立阅读预期。

#### 6.2.0 主要洞察与变化趋势的文案改进（关键）
##### 改进点 1：让「主要洞察」更像“结论”，而不是“描述”
当前问题：主要洞察容易变成“总结性陈述”（复述内容），不够“锋利”。  
建议改法（强约束）：在主要洞察里**强制出现判断性词语**，让用户感知 AI 在“下判断”。推荐句式（任选其一）：
- `当前最明显的特征是：...`
- `当前最值得注意的是：...`
- `核心特征是：...`

示例升级（财经/知识型）：
> 当前最明显的特征是：你的财经笔记高度集中在全球宏观 + 科技产业交叉区域，且以“信息收集 + 初步判断”为主，而非交易执行导向。

##### 改进点 2：让「变化趋势」更具体地回答“变在哪里”
当前问题：变化趋势容易落在“稳定/集中/无明显波动”等安全但偏保守的表达。  
建议改法：补充一个**对比锚点**，让趋势有“时间纵深”。推荐锚点（任选其一）：
- `相比更早阶段...`
- `相比你过往的记录习惯...`
- `相比同一主题的历史表现...`

示例升级（财经/知识型）：
> 记录时间主要集中在近 3 个月，整体频率稳定；相比更早阶段，你对“单一主题的连续追踪”明显增加。

#### 6.2.1 建议卡的正确抽象（非常重要）
❌ 错误抽象：个性化建议 = 系统下一步希望你做什么（偏产品使用说明）  
✅ 正确抽象：建议卡 = AI 基于当前洞察，从用户目标视角给出的下一步可能性

用户意图并不一致，必须按笔记类型切换建议语义模型：
- **知识型笔记（学习/研究/信息吸收）**：例如财经新闻、AI 资讯、学习笔记
  - 目标：我学到哪了？下一步该学什么？
  - 建议方向：成长/学习路径建议（补知识缺口、形成判断框架）
  - 禁止：让用户“为了图表”而改变记录；纯粹的产品使用指导（打标签/优化记录方式）
- **监控型记录（记账/情绪/状态）**：例如记账、健康、情绪记录
  - 目标：这些变化意味着什么？是否存在风险或影响？
  - 建议方向：变化解读/温和风险提示（只说“影响”，避免强建议/命令式）
- **心情类（情绪/状态）**：
  - 目标：我最近的状态对我有什么影响？
  - 建议方向：状态影响/自我觉察（以观察为主，避免“应该/必须”）

#### 6.2.2 建议卡标题与结构（最小可行改造）
1) 标题语义改造：第三张卡标题需按类型动态调整（不强制叫“个性化建议”）
- 知识型：`下一步学习建议` / `你可以重点关注` / `AI 学习提示`
- 监控型：`变化解读` / `风险提示（温和）`
- 心情型：`状态影响` / `自我觉察`

2) 内容结构建议（固定 3 行以内，便于稳定输出）
- 结构仍为「当前关注点/阶段判断 → 下一步方向 → 基于洞察的原因」，但文案**不要出现**“阶段：/下一步：/因为：”等总结词，需写成顺畅自然段落。
- 可选：用 `1.`/`2.` 列出 1–2 个具体方向（更易读）。

#### 6.2.3 「建议语义模型 × 笔记本类型」映射（可直接用）
| notebookType（或推断类型） | 建议语义模型 | 默认标题 | 产出重点 |
|---|---|---|---|
| `finance` / `ai` / `study` | 学习路径建议 | 下一步学习建议 | 阶段判断 + 知识缺口 + 下一步学习方向 |
| `accounting`（未来）/ `monitoring`（推断） | 变化解读/风险提示 | 变化解读 | 只说影响与可能原因，避免强建议 |
| `mood` | 状态影响/自我觉察 | 自我觉察 | 以观察为主，提示可能影响与自我觉察方向 |
| `custom` / 未识别 | 通用温和建议 | 个性化建议 | 轻量可执行、避免命令式 |

### 6.3 图表区（默认显示）
- 默认显示 1 张最佳图表。
- 下拉/Tab 展示最多 2 个备选（总计 ≤3）。
- 切换候选 → 渲染对应图表，同时切换对应洞察内容（保持一致）。
- 图表标题 = “该图回答的问题”。

### 6.4 高级配置区（默认收起）
入口放在图表区右上角，悬停提示：
“查看 AI 选字段依据，可手动调整图表轴位”。

展开后展示三列：
- **AI 推荐图表**（候选列表，含推荐理由、降级原因、所需字段）
- **字段表**（系统/模板/AI 临时字段，来源标记 + 缺失率，支持自定义）
- **图表配置**（X/Y/维度2 候选轴位，拖拽/点击选择）

## 7. AI 分析输出策略
### 7.1 领域无关三维洞察
- `State`（结构/状态）
- `Change`（趋势/变化）
- `Pattern`（规律/异常 / 下一步可能性）

> 说明：第三维 `Pattern` 在 UI 上承载“建议卡”，其语义模型必须随笔记类型变化（见 6.2.1～6.2.3），避免“一套建议模板套所有笔记本”。 

### 7.2 图表候选策略
- AI 给出最多 3 个候选图表：
  - `defaultKey` = 最佳图
  - 其他为备选图
- 候选来源：同一份临时结构化信号（不重复分析）
- 数据不足时仅返回 1 图或 0 图（降级为纯文字洞察）

### 7.3 渲染时机
- 默认渲染最佳图
- 用户切换候选后再渲染该图（按需）

## 8. 数据契约（前后端）
### 8.1 请求
`POST /api/analysis/v3`
```json
{
  "notebookId": "...",
  "timeRange": { "preset": "7d" },
  "noteIds": ["..."]
}
```

### 8.2 响应
```json
{
  "meta": { "recordCount": 38, "startAt": 1730000000, "endAt": 1732592000 },
  "noteType": { "value": "monitoring|developmental|archive", "confidence": 0.8 },
  "insights": [
    { "key": "state", "what": "...", "canDo": "...", "whatElse": "...", "coverage": 0.86, "confidence": 0.78 },
    { "key": "change", "what": "...", "canDo": "...", "whatElse": "...", "coverage": 0.66, "confidence": 0.74 },
    { "key": "pattern", "what": "...", "canDo": "...", "whatElse": "...", "coverage": 0.6, "confidence": 0.7 }
  ],
  "charts": {
    "defaultKey": "trend",
    "items": [
      { "key": "trend", "question": "过去7天如何变化？", "type": "line", "data": { }, "coverage": 0.66, "confidence": 0.74 },
      { "key": "composition", "question": "主要构成是什么？", "type": "bar", "data": { }, "coverage": 0.86, "confidence": 0.78 }
    ]
  },
  "cache": { "hit": true, "ttlSec": 600 }
}
```


## 9. 工程说明（接口/状态机/阈值/缓存）
### 9.1 接口字段与职责
- 请求必须包含：`notebookId` + `timeRange`；可选 `noteIds`（用户勾选时）。
- 响应必须包含：`insights`（3 条）与 `charts`（1~3 个候选）。
- 图表候选字段建议固定：
  - `key`（唯一标识）、`question`（该图回答的问题）
  - `type`（line/bar/pie/heatmap）
  - `data`（渲染所需数据集）
  - `coverage/confidence`（可视化可信度）
- `charts.defaultKey` 必须落在 `charts.items` 内；候选数量上限 3。
- 高级配置区需要的“可解释字段”建议放在 `debug` 或 `analysis_debug`：
  - `fields`: [{ name, role, dataType, source, missingRate, sample }]
  - `axisSuggestions`: { xCandidates, yCandidates, dim2Candidates }
  - `downgradeReasons`: { chartKey: "..." }
  - 该部分可通过 `withDebug=true` 或仅在展开高级配置时请求。

### 9.1.1 接口定义方案（沿用/新增/下沉）
#### 新增（主入口）
- `POST /api/analysis/v3`
  - 请求：
    ```json
    {
      "notebookId": "...",
      "timeRange": { "preset": "7d", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
      "noteIds": ["..."],
      "withDebug": false
    }
    ```
  - 响应（主结果）：
    ```json
    {
      "analysisId": "analysis_...",
      "meta": { "recordCount": 38, "startAt": 1730000000, "endAt": 1732592000 },
      "insights": [ { "key": "state" }, { "key": "change" }, { "key": "pattern" } ],
      "charts": { "defaultKey": "trend", "items": [ { "key": "trend", "type": "line" } ] },
      "cache": { "hit": true, "ttlSec": 600 },
      "debug": { "fields": [], "axisSuggestions": {}, "downgradeReasons": {} }
    }
    ```
- Debug 拉取（二选一）：
  - 方案 A：`POST /api/analysis/v3` 里 `withDebug=true` 直接返回 `debug`
  - 方案 B：`GET /api/analysis/v3/:analysisId/debug`（仅在展开高级配置时拉取）

#### 沿用（历史/配置）
- `POST /api/analysis`：持久化分析结果（允许存 v3 结构的 `analysisData`）。
- `GET /api/analysis` / `GET /api/analysis/:analysisId` / `DELETE /api/analysis/:analysisId`：分析历史与详情查询。
- `POST /api/ai-analysis-config` / `GET /api/ai-analysis-config/:notebookId`：保存/读取高级配置偏好（可选保留）。

#### 下沉为内部能力（前端不直连）
- `POST /api/analysis-run`：旧版一次性分析（与 v3 结构不一致）。
- `POST /api/ai-chart/recommend` / `POST /api/ai-chart/rerank` / `POST /api/ai-chart/derive-fields`：可作为 v3 内部能力。

### 9.1.2 字段细化定义（v3）
#### 请求字段
- `notebookId`：string，必填。
- `timeRange`：object，必填。
  - `preset`：`7d|30d|90d|custom`，默认 `7d`。
  - `from`/`to`：仅当 `preset=custom` 时必填，格式 `YYYY-MM-DD`。
- `noteIds`：string[]，可选；提供时优先按 ID 筛选。
- `withDebug`：boolean，可选；为 true 时返回 `debug`。

#### 响应字段
- `analysisId`：string，本次分析 ID（用于 debug 拉取与历史保存）。
- `meta`：object。
  - `recordCount`：number，本次分析记录数。
  - `startAt`/`endAt`：number，Unix 时间戳（秒）。
- `noteType`：object，可选。
  - `value`：`monitoring|developmental|archive`
  - `confidence`：0~1
- `insights`：array，固定 3 条，按 `state/change/pattern` 排序。
  - `key`：`state|change|pattern`
  - `what`：string，必填
  - `canDo`：string，可为空（监控型可弱化）
  - `whatElse`：string，可为空
  - `coverage`/`confidence`：0~1
- `charts`：object。
  - `defaultKey`：string，必须在 `items` 内。
  - `items`：array，最多 3 条；允许为空（纯文字洞察降级）。
    - `key`：string，唯一标识
    - `question`：string，图表回答的问题
    - `type`：`line|bar|pie|heatmap`
    - `data`：object，按类型一致化结构
      - 折线/面积：`{ xKey, yKey, rows, granularity? }`
      - 柱状/饼图：`{ categoryKey, valueKey, rows }`
      - 热力图：`{ xKey, yKey, valueKey, rows }`
      - `rows`：array，行数据（字段名与 key 对齐）
    - `coverage`/`confidence`：0~1
- `cache`：object。
  - `hit`：boolean
  - `ttlSec`：number
- `debug`：object，可选。
  - `fields`：[{ name, role, dataType, source, missingRate, sample }]
  - `axisSuggestions`：{ xCandidates, yCandidates, dim2Candidates }
  - `downgradeReasons`：{ chartKey: "..." }

### 9.1.3 图表候选策略（类型 → 候选）
用于后端在 v3 流程中按笔记本类型筛选/排序候选图表，模型只在候选内做排序或说明。
```json
{
  "default": {
    "preferredCandidates": ["trend", "weekday", "length"],
    "fallbackCandidates": ["trend", "weekday", "length"]
  },
  "mood": {
    "preferredCandidates": ["trend", "weekday", "mood_event"],
    "fallbackCandidates": ["trend", "weekday", "length"],
    "candidateRules": {
      "mood_event": { "minCategories": 2 }
    }
  },
  "life": {
    "preferredCandidates": ["trend", "weekday", "length"],
    "fallbackCandidates": ["trend", "weekday", "length"]
  }
}
```

### 9.2 前端状态机与组件拆分
- 状态机：`idle` → `loading` → `ready` → `error`
- 关键状态：
  - `analysisResult`：承载洞察与候选图表
  - `selectedChartKey`：当前图表候选
  - `configExpanded`：高级配置是否展开
- 组件建议：
  - `AnalysisFilters`（筛选区）
  - `InsightCards`（三张洞察卡）
  - `ChartPanel`（图表 + 候选切换）
  - `AdvancedConfigPanel`（字段表/轴位/自定义）
- 数据流：
  - 点击“分析/刷新” → 请求 `/api/analysis/v3` → 写入 `analysisResult`
  - 默认选 `charts.defaultKey` 作为当前图表
  - 切换候选时仅更新 `selectedChartKey` 并渲染对应图
  - 展开高级配置时再加载 `debug` 信息（若需要）

### 9.3 阈值/降级规则（工程可执行）
- 必要门槛：`coverage >= 0.6` 且 `confidence >= 0.7`
- 折线：时间桶 < 7 时降粒度（天→周→月），仍不足则降级为柱状对比
- 分布：类别数 > 12 时做 TopN + 其他；类别过于分散则不返回该候选
- 热力：稀疏度 < 0.1 直接放弃该候选
- 不达标时：不返回图表候选，仅保留文字洞察

### 9.4 缓存策略与 TTL
- 缓存 Key：`userId + notebookId + timeRange + noteIds + lastUpdatedAt`
- TTL 建议 10~30 分钟；有新记录写入时立即失效
- 前端显示缓存命中（可选），并提供“强制刷新”按钮
- 若使用 `analysisId` 持久化，则 `debug` 可与主结果分开缓存

## 10. 阈值与降级
- 图表候选必须满足：
  - `coverage >= 0.6` 且 `confidence >= 0.7`
  - 线图至少 7 个时间桶；分布图类别数 ≤ 12（否则 TopN+其他）
- 不达标 → 不返回该候选；仅保留文字洞察。

## 11. 埋点与指标
- 分析页面进入率、分析触发率
- 默认图曝光率、备选图切换率
- 7 日复访率

## 12. 风险与对策
- 数据不足：显示“数据不足，仅提供文字洞察”
- 误导风险：监控型不输出强行为建议
- 成本风险：一次分析产出多图候选，切换仅渲染不再二次调用

## 13. 里程碑
- M1：新接口 + 前端主路径（洞察卡 + 默认图 + 备选切换）
- M2：高级配置区折叠可用（字段表/拖轴位）

## 14. 渐进路线（图表策略优化）
1) 规则策略表（类型 → 候选）先落地，保证可控与稳定。
2) LLM 仅在候选集合内排序/挑选，不允许自由生成图表类型。
3) 记录用户切换/偏好作为训练样本积累。
4) 样本充足后再考虑 SFT 或偏好优化（DPO/RLHF）。
