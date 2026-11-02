/* mock.js — 唯一数据源。所有页面从这里读数,禁止散落硬编码。 */
window.DB = {

  /* ---------- 垂直领域工作台 ---------- */
  workbenches: [
    { id: 'wb-doc',    name: '文件审查工作台', icon: 'file-check',  color: '#6C63F0',
      desc: '合同、标书、合规文件的自动审查与风险标注,支持批注回流与审查底稿归档。',
      projectIds: ['p1', 'p2', 'p7'], stats: { running: 3, tokenToday: '1.2M' } },
    { id: 'wb-bi',     name: '业务分析工作台', icon: 'bar-chart-3', color: '#4C9AFF',
      desc: '连接业务数据库与报表口径,由智能体完成取数、归因分析与经营周报生成。',
      projectIds: ['p3', 'p4'], stats: { running: 2, tokenToday: '860K' } },
    { id: 'wb-ops',    name: '舆情监测工作台', icon: 'activity',    color: '#3FB6B2',
      desc: '7×24 监测公开渠道舆情信号,定时任务驱动,自动聚类、研判并推送预警。',
      projectIds: ['p5'], stats: { running: 1, tokenToday: '410K' } },
    { id: 'wb-dev',    name: '研发协同工作台', icon: 'terminal',    color: '#B074E8',
      desc: '需求拆解、代码审查与发布检查清单的自动化协同,沉淀团队工程知识。',
      projectIds: ['p6'], stats: { running: 2, tokenToday: '980K' } },
    { id: 'wb-sysops', name: '系统运维工作台', icon: 'wrench',      color: '#E0645F',
      desc: '服务器巡检、故障应急与日志根因分析的自动化运维,7×24 守护系统稳定性。',
      projectIds: ['p8', 'p9'], stats: { running: 2, tokenToday: '730K' } },
    { id: 'wb-legal',  name: '法律文书工作台', icon: 'file-text',   color: '#D97757',
      desc: '合同与诉讼文书的智能起草、合规审查与类案检索,沉淀律所级文书资产。',
      projectIds: ['p10', 'p11'], stats: { running: 2, tokenToday: '560K' } }
  ],

  /* ---------- 专业工作台顶层定义(wbId → 业务本体定义 + 引用配置) ---------- */
  wbConfigs: {
    'wb-doc': {
      bizName: '文件审查业务', domain: '法务合规',
      bizDef: '面向企业法务与采购部门的文件审查业务:对合同、标书、合规文件进行自动审查、风险标注与底稿归档,审查结论可批注回流。',
      kbRefs: ['sk2'], agentIds: ['a1', 'a4', 'a9'], tplIds: ['pt5']
    },
    'wb-bi': {
      bizName: '业务分析业务', domain: '经营分析',
      bizDef: '面向经营管理层的业务分析业务:连接业务数据库与报表口径,由智能体完成取数、归因分析与经营周报生成。',
      kbRefs: ['sk5', 'sk6'], agentIds: ['a1', 'a2'], tplIds: ['pt1', 'pt7']
    },
    'wb-ops': {
      bizName: '舆情监测业务', domain: '品牌公关',
      bizDef: '面向品牌与公关团队的舆情监测业务:7×24 监测公开渠道舆情信号,自动聚类、研判并分级推送预警。',
      kbRefs: ['sk1'], agentIds: ['a2'], tplIds: ['pt9', 'pt10']
    },
    'wb-dev': {
      bizName: '研发协同业务', domain: '软件工程',
      bizDef: '面向研发团队的协同业务:需求拆解、代码审查与发布检查清单自动化,沉淀团队工程知识资产。',
      kbRefs: ['sk6'], agentIds: ['a5'], tplIds: ['pt3']
    },
    'wb-sysops': {
      bizName: '系统运维业务', domain: 'IT 运维',
      bizDef: '面向运维团队的自动化运维业务:服务器巡检、故障应急与日志根因分析,保障生产系统 7×24 稳定运行。',
      kbRefs: ['sk3'], agentIds: ['a7', 'a8'], tplIds: ['pt8']
    },
    'wb-legal': {
      bizName: '法律文书业务', domain: '法律服务',
      bizDef: '面向律所与企业法务的文书业务:合同与诉讼文书智能起草、合规审查与类案检索,沉淀律所级文书资产。',
      kbRefs: ['sk2'], agentIds: ['a9', 'a10'], tplIds: ['pt5']
    }
  },

  /* ---------- 项目(资源核心) ---------- */
  projects: [
    { id: 'p1', name: '采购合同年度审查', workbenchId: 'wb-doc', status: 'active',
      desc: '对 2026 年度供应商采购合同进行批量合规审查,输出风险条款清单与修订建议。',
      createdAt: '2026-07-02', agentIds: ['a1', 'a4'],
      stats: { tasks: 24, tokens: '4.6M', cost: '¥ 312.40' } },
    { id: 'p2', name: '投标文件合规核查', workbenchId: 'wb-doc', status: 'active',
      desc: '投标前对技术标、商务标进行一致性与废标项核查。',
      createdAt: '2026-07-18', agentIds: ['a1'],
      stats: { tasks: 9, tokens: '1.1M', cost: '¥ 78.20' } },
    { id: 'p3', name: '华东区经营分析', workbenchId: 'wb-bi', status: 'active',
      desc: '华东大区月度经营数据归因分析,自动生成管理驾驶舱周报。',
      createdAt: '2026-06-11', agentIds: ['a2', 'a5'],
      stats: { tasks: 31, tokens: '6.8M', cost: '¥ 455.60' } },
    { id: 'p4', name: '渠道库存健康度', workbenchId: 'wb-bi', status: 'archived',
      desc: '渠道库存周转与滞销风险监测,周度推送补货建议。',
      createdAt: '2026-05-28', agentIds: ['a2'],
      stats: { tasks: 12, tokens: '2.2M', cost: '¥ 149.00' } },
    { id: 'p7', name: '2025 年度合同审查(归档)', workbenchId: 'wb-doc', status: 'archived',
      desc: '2025 年度供应商合同批量审查专项,已结项归档,数据保留供检索复用。',
      createdAt: '2025-03-10', agentIds: ['a1'],
      stats: { tasks: 46, tokens: '7.9M', cost: '¥ 520.00' } },
    { id: 'p5', name: '品牌舆情日报', workbenchId: 'wb-ops', status: 'active',
      desc: '每日 8:00 汇总全网品牌提及,负面信号分级预警。',
      createdAt: '2026-08-01', agentIds: ['a3'],
      stats: { tasks: 19, tokens: '3.0M', cost: '¥ 201.80' } },
    { id: 'p6', name: '发布前检查自动化', workbenchId: 'wb-dev', status: 'active',
      desc: '版本发布前的回归清单、变更风险评估与发布通告起草。',
      createdAt: '2026-07-25', agentIds: ['a6'],
      stats: { tasks: 7, tokens: '900K', cost: '¥ 61.50' } },
    { id: 'p8', name: '服务器巡检自动化', workbenchId: 'wb-sysops', status: 'active',
      desc: '每日定时巡检 120 台生产服务器,CPU/内存/磁盘/证书阈值检查,异常自动生成工单。',
      createdAt: '2026-06-20', agentIds: ['a7'],
      stats: { tasks: 58, tokens: '5.1M', cost: '¥ 342.60' } },
    { id: 'p9', name: '故障应急响应演练', workbenchId: 'wb-sysops', status: 'active',
      desc: '按预案库执行故障注入与恢复演练,复盘输出 RTO/RPO 达标报告。',
      createdAt: '2026-07-09', agentIds: ['a7', 'a8'],
      stats: { tasks: 16, tokens: '2.4M', cost: '¥ 168.30' } },
    { id: 'p10', name: '合同文书智能起草', workbenchId: 'wb-legal', status: 'active',
      desc: '基于模板库与交易要素,批量起草买卖、租赁、劳动等高频合同并交叉校验。',
      createdAt: '2026-07-14', agentIds: ['a9'],
      stats: { tasks: 37, tokens: '3.8M', cost: '¥ 256.40' } },
    { id: 'p11', name: '诉讼材料合规审查', workbenchId: 'wb-legal', status: 'active',
      desc: '起诉状、答辩状与证据清单的格式合规审查,附类案判例引用建议。',
      createdAt: '2026-08-05', agentIds: ['a9', 'a10'],
      stats: { tasks: 11, tokens: '1.5M', cost: '¥ 104.70' } }
  ],

  /* ---------- 专家智能体(能力核心) ---------- */
  agents: [
    { id: 'a1', name: '法务审查专家 · 明察', initials: '明', color: '#6C63F0',
      role: '合同合规审查', model: 'DeepSeek-V3.2', level: 12, xp: 76,
      tagline: '擅长识别合同中的付款、违约、知识产权与管辖条款风险。',
      sop: ['读取文件并切分条款', '按风险清单逐项比对', '标注风险等级与依据', '生成修订建议与底稿'],
      kbIds: ['kb1', 'kb2'], plugins: ['文档解析', '条款比对', '法规检索'],
      stats: { tasks: 138, successRate: 96.4, tokens: '12.4M', cost: '¥ 838.00' } },
    { id: 'a2', name: '经营分析专家 · 观澜', initials: '观', color: '#4C9AFF',
      role: '经营数据分析', model: 'Qwen3-235B', level: 15, xp: 62,
      tagline: '从取数到归因,输出可直接上会使用的经营分析结论。',
      sop: ['确认分析口径', '编写并执行 SQL', '异常归因与交叉验证', '生成图表与结论'],
      kbIds: ['kb3'], plugins: ['SQL 执行', '图表生成', '指标口径库'],
      stats: { tasks: 201, successRate: 94.8, tokens: '18.9M', cost: '¥ 1,204.00' } },
    { id: 'a3', name: '舆情研判专家 · 闻涛', initials: '闻', color: '#3FB6B2',
      role: '舆情监测研判', model: 'Kimi-K2', level: 9, xp: 41,
      tagline: '对海量提及进行聚类、情感研判与传播链路还原。',
      sop: ['多源信号采集', '聚类去重', '情感与烈度分级', '生成预警与日报'],
      kbIds: ['kb4'], plugins: ['网页浏览', '微博采集', '钉钉推送'],
      stats: { tasks: 96, successRate: 92.1, tokens: '7.3M', cost: '¥ 462.00' } },
    { id: 'a4', name: '财税审校专家 · 钧衡', initials: '钧', color: '#E09A5B',
      role: '财税条款审校', model: 'DeepSeek-V3.2', level: 7, xp: 23,
      tagline: '复核合同中的税率、发票、结算与账期条款的一致性。',
      sop: ['提取财税条款', '税率口径校验', '输出差异清单'],
      kbIds: ['kb2'], plugins: ['文档解析', '税率查询'],
      stats: { tasks: 44, successRate: 95.5, tokens: '2.8M', cost: '¥ 176.00' } },
    { id: 'a5', name: '数据可视化专家 · 丹青', initials: '丹', color: '#B074E8',
      role: '图表与报告', model: 'Qwen3-235B', level: 6, xp: 12,
      tagline: '把分析结论转化为管理层一眼可读的图表与版式。',
      sop: ['选择图表类型', '渲染校验', '嵌入报告模板'],
      kbIds: [], plugins: ['图表生成', '报告排版'],
      stats: { tasks: 27, successRate: 97.0, tokens: '1.4M', cost: '¥ 88.00' } },
    { id: 'a6', name: '发布检查专家 · 守门', initials: '守', color: '#E078B0',
      role: '发布风险检查', model: 'Kimi-K2', level: 8, xp: 55,
      tagline: '按发布清单逐项核验,拦截高风险变更。',
      sop: ['拉取变更集', '逐项核验清单', '风险分级', '起草发布通告'],
      kbIds: ['kb5'], plugins: ['Git 查询', 'CI 状态', '通告模板'],
      stats: { tasks: 52, successRate: 98.1, tokens: '3.9M', cost: '¥ 244.00' } },
    { id: 'a7', name: '运维诊断专家 · 司南', initials: '司', color: '#E0645F',
      role: '系统巡检诊断', model: 'DeepSeek-V3.2', level: 11, xp: 68,
      tagline: '7×24 巡检服务器健康度,异常自动定位、分级并生成处置工单。',
      sop: ['采集指标快照', '阈值与趋势比对', '异常分级定位', '生成处置建议与工单'],
      kbIds: ['kb6'], plugins: ['Shell 执行', '指标采集', '告警推送'],
      stats: { tasks: 173, successRate: 95.2, tokens: '9.6M', cost: '¥ 646.00' } },
    { id: 'a8', name: '日志分析专家 · 烛照', initials: '烛', color: '#5BB8E0',
      role: '日志根因分析', model: 'Kimi-K2', level: 7, xp: 34,
      tagline: '从海量日志中聚类异常模式,还原故障链路并定位根因。',
      sop: ['拉取故障时段日志', '异常模式聚类', '链路还原', '输出根因与复盘建议'],
      kbIds: ['kb6', 'kb7'], plugins: ['日志检索', '模式聚类'],
      stats: { tasks: 64, successRate: 93.7, tokens: '4.1M', cost: '¥ 268.00' } },
    { id: 'a9', name: '文书起草专家 · 翰林', initials: '翰', color: '#D97757',
      role: '法律文书起草', model: 'Qwen3-235B', level: 13, xp: 71,
      tagline: '按模板与交易要素起草合同文书,条款完备性与表述规范双校验。',
      sop: ['解析交易要素', '匹配模板与条款库', '起草正文', '完备性校验与润色'],
      kbIds: ['kb8'], plugins: ['模板库', '格式排版', '法条引用'],
      stats: { tasks: 156, successRate: 96.9, tokens: '11.2M', cost: '¥ 758.00' } },
    { id: 'a10', name: '案例检索专家 · 判司', initials: '判', color: '#C25E8E',
      role: '类案判例检索', model: 'DeepSeek-V3.2', level: 9, xp: 47,
      tagline: '按争议焦点检索类案判例,提炼裁判要旨供文书引用。',
      sop: ['提炼争议焦点', '类案检索与筛选', '裁判要旨归纳', '生成引用建议'],
      kbIds: ['kb9'], plugins: ['判例检索', '要旨归纳'],
      stats: { tasks: 83, successRate: 94.0, tokens: '5.5M', cost: '¥ 362.00' } }
  ],

  /* ---------- 扩展授权(上架/上线/使用三类审批流) ---------- */
  /* cat: ext=扩展市场上架审核 | agent=专家智能体市场上线审核 | usage=专家使用扩展能力授权申请 */
  /* status: pending 待审核 | approved 已批准 | rejected 已拒绝 */
  extAuth: [
    { id: 'ea1', cat: 'ext', kind: 'skill', target: 'PPT 智能生成', applicant: '林晓', reason: '新增技能,申请上架扩展市场', time: '08-23 14:20', status: 'pending' },
    { id: 'ea2', cat: 'ext', kind: 'mcp', target: '飞书 MCP 服务', applicant: '苏航', reason: '接入飞书开放文档,申请上架', time: '08-22 09:40', status: 'approved', approver: '沈言' },
    { id: 'ea3', cat: 'ext', kind: 'plugin', target: 'Markdown 渲染', applicant: '陈默', reason: '首次上架申请', time: '08-20 16:05', status: 'approved', approver: '沈言' },
    { id: 'ea4', cat: 'agent', kind: 'agent', target: '行业研究专家 · 启明', applicant: '顾远', reason: '上线专家智能体市场', time: '08-23 11:12', status: 'pending' },
    { id: 'ea5', cat: 'agent', kind: 'agent', target: '竞品分析专家 · 洞见', applicant: '林晓', reason: '上线专家智能体市场', time: '08-19 10:30', status: 'rejected', approver: '沈言', note: '能力描述不完整,请补充后重新提交' },
    { id: 'ea6', cat: 'usage', kind: 'plugin', target: '网页抓取', agent: '文书处理专家 · 明远', applicant: '沈言', reason: '任务需要抓取公开网页资料', time: '08-23 15:02', status: 'pending' },
    { id: 'ea7', cat: 'usage', kind: 'mcp', target: '飞书 MCP 服务', agent: '数据洞察专家 · 明澈', applicant: '苏航', reason: '同步运营报表到飞书群', time: '08-21 13:44', status: 'approved', approver: '沈言' },
    { id: 'ea8', cat: 'usage', kind: 'mcp', target: '数据库读写 MCP', agent: '合规审计专家 · 正则', applicant: '陈默', reason: '审计任务需直连 ERP 库取证', time: '08-18 17:26', status: 'rejected', approver: '沈言', note: '涉及生产库写权限,改用只读连接重新申请' }
  ],

  /* ---------- 会话任务(kind: normal=普通任务 / cron=定时任务) ---------- */
  sessions: [
    { id: 's1',  projectId: 'p1', agentId: 'a1', agentIds: ['a1', 'a4'], kind: 'normal', title: '审查《2026 年度服务器采购框架协议》', status: 'running', updatedAt: '10:42', tokens: '48.2K', msgCount: 14 },
    { id: 's2',  projectId: 'p1', agentId: 'a1', kind: 'normal', title: '批量审查 8 份供应商补充协议', status: 'done',    updatedAt: '昨天', tokens: '132K',  msgCount: 32 },
    { id: 's3',  projectId: 'p1', agentId: 'a4', kind: 'normal', title: '复核框架协议的税率与账期条款', status: 'waiting', updatedAt: '昨天', tokens: '0',     msgCount: 0 },
    { id: 's4',  projectId: 'p1', agentId: 'a1', kind: 'cron',   title: 'IDC 机房租赁合同风险复查', status: 'failed',  updatedAt: '08-18', tokens: '21.5K', msgCount: 6 },
    { id: 's5',  projectId: 'p1', agentId: 'a1', kind: 'normal', title: '云服务 SLA 条款比对分析', status: 'done',    updatedAt: '08-15', tokens: '96K',   msgCount: 21 },
    { id: 's6',  projectId: 'p3', agentId: 'a2', kind: 'normal', title: '7 月华东区销售毛利归因分析', status: 'running', updatedAt: '11:05', tokens: '66.8K', msgCount: 18 },
    { id: 's7',  projectId: 'p3', agentId: 'a5', kind: 'cron',   title: '生成华东经营周报图表包', status: 'done',    updatedAt: '昨天', tokens: '44K',   msgCount: 9 },
    { id: 's8',  projectId: 'p5', agentId: 'a3', kind: 'cron',   title: '今日品牌负面信号研判', status: 'done',    updatedAt: '08:00', tokens: '58K',   msgCount: 12 },
    { id: 's9',  projectId: 'p8', agentId: 'a7', kind: 'cron',   title: '今日生产服务器定时巡检', status: 'running', updatedAt: '11:20', tokens: '32.6K', msgCount: 8 },
    { id: 's10', projectId: 'p8', agentId: 'a7', kind: 'normal', title: 'DB-07 磁盘占用异常排查', status: 'done',    updatedAt: '昨天', tokens: '74K',   msgCount: 16 },
    { id: 's11', projectId: 'p9', agentId: 'a8', kind: 'normal', title: '支付网关超时故障根因分析', status: 'running', updatedAt: '10:58', tokens: '41.2K', msgCount: 11 },
    { id: 's12', projectId: 'p9', agentId: 'a7', kind: 'cron',   title: '每月容灾切换演练复盘', status: 'failed',  updatedAt: '08-12', tokens: '18.9K', msgCount: 5 },
    { id: 's13', projectId: 'p10', agentId: 'a9', kind: 'normal', title: '起草《设备买卖合同》三份变体', status: 'done',    updatedAt: '昨天', tokens: '88K',   msgCount: 19 },
    { id: 's14', projectId: 'p11', agentId: 'a10', kind: 'normal', title: '服务合同纠纷类案检索报告', status: 'running', updatedAt: '11:32', tokens: '27.4K', msgCount: 7 }
  ],

  /* ---------- 对话消息(按会话) ---------- */
  messages: {
    s1: [
      { id: 'm1', role: 'user', type: 'text', time: '10:31',
        content: '请审查这份《2026 年度服务器采购框架协议》,重点关注付款方式、违约责任和知识产权归属,输出风险清单。' },
      { id: 'm2', role: 'agent', type: 'steps', time: '10:32',
        content: '已完成文档解析与条款切分,共识别 47 个条款。下面按 SOP 逐项比对风险清单。',
        steps: [
          { icon: 'file-text', title: '解析文档', detail: '采购框架协议_v4.docx · 23,418 字 · 47 个条款', status: 'done', duration: '12s' },
          { icon: 'book-open', title: '检索知识库', detail: '命中《采购合同风险清单 v3》《民法典合同编要点》', status: 'done', duration: '4s' },
          { icon: 'search', title: '条款逐项比对', detail: '47/47 完成 · 发现高风险 3 项 / 中风险 5 项 / 提示 8 项', status: 'done', duration: '86s' },
          { icon: 'pencil', title: '生成审查底稿', detail: 'risk_review_draft.md 已写入项目文件', status: 'doing', duration: '' }
        ] },
      { id: 'm3', role: 'agent', type: 'text', time: '10:38',
        content: '初步发现 3 项高风险条款:\n\n1. 第 8.2 条付款方式 —— 约定「验收合格后 180 日内付款」,账期显著长于公司 60 日标准,且无逾期利息条款。\n2. 第 12.1 条违约责任 —— 我方违约金上限为合同总额 20%,对方仅为 5%,责任不对等。\n3. 第 15.3 条知识产权 —— 定制开发成果约定归对方所有,未保留我方二次使用权。\n\n建议对以上条款发起修订,是否需要我生成修订建议稿?' },
      { id: 'm4', role: 'user', type: 'text', time: '10:40',
        content: '先针对第 12.1 条给出修订建议,并说明依据。' },
      { id: 'm5', role: 'agent', type: 'text', time: '10:42',
        content: '针对第 12.1 条的修订建议:\n\n建议将双方违约金上限统一为合同总额的 10%,并增加「因对方原因导致项目延期的,每逾期一日按合同总额 0.05% 计收违约金」。\n\n依据:公司《合同管理办法》第 6.2 条要求违约责任对等;《民法典》第 585 条允许约定违约金,对等约定可降低争议时被调整的风险。修订对照表已同步至待办清单。' }
    ],
    s6: [
      { id: 'm1', role: 'user', type: 'text', time: '10:55',
        content: '分析 7 月华东区毛利率环比下滑 2.3pct 的原因,拆到品类维度。' },
      { id: 'm2', role: 'agent', type: 'steps', time: '10:56',
        content: '已确认分析口径(管理口径,不含内部交易),正在取数。',
        steps: [
          { icon: 'database', title: '执行 SQL 取数', detail: 'dw_sales_mart · 7 月 vs 6 月 · 品类维度', status: 'done', duration: '9s' },
          { icon: 'search', title: '异常归因', detail: '毛利率下滑 2.3pct = 价格因素 -1.6pct + 成本因素 -0.5pct + 结构因素 -0.2pct', status: 'done', duration: '31s' },
          { icon: 'bar-chart-3', title: '生成图表', detail: '瀑布图 + 品类热力表渲染中', status: 'doing', duration: '' }
        ] },
      { id: 'm3', role: 'agent', type: 'text', time: '11:05',
        content: '归因结论:7 月毛利率下滑主要由「厨卫电器」品类价格战导致(贡献 -1.4pct),该品类 7 月均价环比下降 6.8%;其次是铜价上行推高「空调」品类成本(贡献 -0.5pct)。建议关注 8 月促销排期与套购组合的毛利保护策略。完整图表已生成,可在右侧文件面板查看。' }
    ]
  },

  /* ---------- 任务待办 ---------- */
  todos: {
    s1: [
      { id: 't1', text: '解析文档并切分条款', status: 'done' },
      { id: 't2', text: '按风险清单逐项比对 47 个条款', status: 'done' },
      { id: 't3', text: '生成 3 项高风险条款的修订建议', status: 'doing' },
      { id: 't4', text: '输出审查底稿并归档至项目文件', status: 'doing' },
      { id: 't5', text: '同步修订对照表给法务负责人确认', status: 'todo' },
      { id: 't6', text: '将本次审查要点回流至专家记忆', status: 'todo' }
    ],
    s6: [
      { id: 't1', text: '确认分析口径(管理口径)', status: 'done' },
      { id: 't2', text: '取数:7 月 vs 6 月品类毛利', status: 'done' },
      { id: 't3', text: '瀑布归因与交叉验证', status: 'done' },
      { id: 't4', text: '生成图表包与归因结论', status: 'doing' },
      { id: 't5', text: '推送周报到管理群', status: 'todo' }
    ]
  },

  /* ---------- 文件 ---------- */
  files: {
    s1: [
      { id: 'f1', name: '采购框架协议_v4.docx', type: 'doc', size: '2.4 MB', updatedAt: '10:31' },
      { id: 'f2', name: 'risk_review_draft.md', type: 'md', size: '18 KB', updatedAt: '10:38' },
      { id: 'f3', name: '条款修订对照表.xlsx', type: 'sheet', size: '96 KB', updatedAt: '10:42' },
      { id: 'f4', name: '整改建议清单.md', type: 'md', size: '6 KB', updatedAt: '10:45' }
    ],
    s6: [
      { id: 'f1', name: '毛利归因瀑布图.html', type: 'html', size: '42 KB', updatedAt: '11:04' },
      { id: 'f2', name: '品类毛利明细.csv', type: 'csv', size: '128 KB', updatedAt: '11:02' }
    ],
    p1: [
      { id: 'pf1', name: '采购框架协议_v4.docx', type: 'doc', size: '2.4 MB', updatedAt: '今天 10:31' },
      { id: 'pf2', name: '补充协议_打包_8份.zip', type: 'zip', size: '14 MB', updatedAt: '昨天 16:20' },
      { id: 'pf3', name: 'risk_review_draft.md', type: 'md', size: '18 KB', updatedAt: '今天 10:38' },
      { id: 'pf4', name: 'IDC机房租赁合同.pdf', type: 'pdf', size: '5.1 MB', updatedAt: '08-18 14:02' },
      { id: 'pf5', name: '条款修订对照表.xlsx', type: 'sheet', size: '96 KB', updatedAt: '今天 10:42' }
    ]
  },

  /* ---------- 项目文件目录树(知识库 Tab 资源管理器) ---------- */
  fileTree: {
    p1: [
      { name: '合同文本', children: [
        { name: '采购框架协议_v4.docx', type: 'doc', size: '2.4 MB', updatedAt: '今天 10:31' },
        { name: 'IDC机房租赁合同.pdf', type: 'pdf', size: '5.1 MB', updatedAt: '08-18 14:02' },
        { name: '补充协议_打包_8份.zip', type: 'zip', size: '14 MB', updatedAt: '昨天 16:20' }
      ]},
      { name: '审查底稿', children: [
        { name: 'risk_review_draft.md', type: 'md', size: '18 KB', updatedAt: '今天 10:38' },
        { name: '条款比对记录_2025Q3.md', type: 'md', size: '24 KB', updatedAt: '08-16 17:20' }
      ]},
      { name: '输出', children: [
        { name: '条款修订对照表.xlsx', type: 'sheet', size: '96 KB', updatedAt: '今天 10:42' }
      ]}
    ],
    p3: [
      { name: '数据报表', children: [
        { name: '毛利归因瀑布图.html', type: 'html', size: '42 KB', updatedAt: '今天 11:04' },
        { name: '品类毛利明细.csv', type: 'csv', size: '128 KB', updatedAt: '今天 11:02' }
      ]},
      { name: '周报归档', children: [
        { name: '经营周报_W33.docx', type: 'doc', size: '1.1 MB', updatedAt: '08-18 09:30' }
      ]}
    ]
  },

  /* ---------- 审计轨迹 ---------- */
  audit: {
    s1: [
      { id: 'au1', time: '10:31:08', actor: '用户', type: 'system', action: '创建任务', detail: '指定专家:法务审查专家 · 明察;附件:采购框架协议_v4.docx', duration: '-', tokens: '-' },
      { id: 'au2', time: '10:31:20', actor: '明察', type: 'tool', action: '调用工具: 文档解析', detail: 'docx → 结构化条款树 · 23,418 字', duration: '12s', tokens: '1.2K' },
      { id: 'au3', time: '10:31:35', actor: '明察', type: 'think', action: '规划执行路径', detail: '加载 SOP「合同合规审查」,匹配风险清单 v3,规划 47 个条款的比对批次(每批 8 条)', duration: '3s', tokens: '0.8K' },
      { id: 'au4', time: '10:31:42', actor: '明察', type: 'tool', action: '调用工具: 知识库检索', detail: 'query="采购合同 付款 违约 知识产权 风险" · 命中 4 篇文档', duration: '4s', tokens: '2.1K' },
      { id: 'au5', time: '10:33:10', actor: '明察', type: 'decision', action: '风险判定: 第 8.2 条', detail: '账期 180 日 > 标准 60 日,判定【高风险】,置信度 0.93', duration: '-', tokens: '0.4K' },
      { id: 'au6', time: '10:35:47', actor: '明察', type: 'decision', action: '风险判定: 第 12.1 条', detail: '违约金上限不对等(20% vs 5%),判定【高风险】,置信度 0.97', duration: '-', tokens: '0.4K' },
      { id: 'au7', time: '10:36:58', actor: '明察', type: 'decision', action: '风险判定: 第 15.3 条', detail: '定制成果知识产权归属对方且未保留使用权,判定【高风险】,置信度 0.91', duration: '-', tokens: '0.5K' },
      { id: 'au8', time: '10:38:22', actor: '明察', type: 'file', action: '写入文件', detail: 'risk_review_draft.md → 项目文件 /审查底稿/', duration: '2s', tokens: '3.6K' },
      { id: 'au9', time: '10:40:15', actor: '用户', type: 'system', action: '追加指令', detail: '「先针对第 12.1 条给出修订建议,并说明依据」', duration: '-', tokens: '-' },
      { id: 'au10', time: '10:42:03', actor: '明察', type: 'browser', action: '浏览网页', detail: '法规检索:民法典第 585 条 · npc.gov.cn', duration: '8s', tokens: '1.8K' },
      { id: 'au11', time: '10:42:31', actor: '明察', type: 'file', action: '写入文件', detail: '条款修订对照表.xlsx → 项目文件 /输出/', duration: '3s', tokens: '2.2K' }
    ]
  },

  /* ---------- 数据库连接内的数据表(数据管理页) ---------- */
  dbTables: {
    db1: [
      { name: 'fact_sales_daily', columns: ['date', 'category', 'gross_margin', 'qty'], rows: [
        ['2025-07-01', '厨卫', '18.4%', '1,204'],
        ['2025-07-02', '空调', '21.1%', '986'],
        ['2025-07-03', '冰洗', '16.9%', '754']
      ]},
      { name: 'dim_category', columns: ['id', 'name', 'parent'], rows: [
        ['C01', '厨卫', 'ROOT'],
        ['C02', '空调', 'ROOT']
      ]}
    ],
    db4: [
      { name: 'contract_archive', columns: ['contract_no', 'vendor', 'amount', 'signed_at'], rows: [
        ['HT-2024-0118', '云启科技', '¥1,280,000', '2024-11-02'],
        ['HT-2025-0042', '恒信物流', '¥356,000', '2025-03-18']
      ]}
    ]
  },

  /* ---------- 任务上下文资料(按 sessionId 索引,顶栏"上下文"按钮展示) ---------- */
  /* ---------- 文件内容(任务页预览 / 源码演示,按文件名索引) ---------- */
  fileContents: {
    'risk_review_draft.md': [
      '# 采购合同风险审查底稿',
      '',
      '> 生成于 10:38 · 法务审查专家 · 明察',
      '',
      '## 高风险条款',
      '',
      '- **第 8.2 条 付款方式**:账期 180 日,显著超出公司 60 日标准,且无逾期利息约定。建议压缩至 60 日并补逾期利息条款。',
      '- **第 12.1 条 违约责任**:双方违约金上限不对等(20% vs 5%)。建议统一为 10% 并增加逾期按日计收。',
      '- **第 15.3 条 知识产权**:定制开发成果归属对方,未保留我方二次使用权。建议约定共有或保留使用权。',
      '',
      '## 比对结论',
      '',
      '比对进度 `47/47` · 高风险 **3** / 中风险 **5** / 提示 **8**',
      '',
      '---',
      '',
      '依据:《采购合同风险清单 v3》《民法典》第 585 条'
    ].join('\n'),
    '整改建议清单.md': [
      '# 整改建议清单',
      '',
      '> 生成于 10:45 · 法务审查专家 · 明察',
      '',
      '## 必改项(高风险)',
      '',
      '1. 付款账期由 180 日压缩至 **60 日**,补充逾期利息条款(按日万分之五)。',
      '2. 违约金上限双方统一为合同总额的 **10%**。' ,
      '3. 定制开发成果约定**共有**,我方保留二次使用权。',
      '',
      '## 建议项(中风险)',
      '',
      '- 保密期限由 1 年延长至 3 年。',
      '- 争议解决约定由我方所在地法院管辖。',
      '',
      '---',
      '',
      '以上建议已同步至 `条款修订对照表.xlsx`。'
    ].join('\n'),
    '毛利归因瀑布图.html': [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <title>毛利归因瀑布图</title>',
      '  <link rel="stylesheet" href="./waterfall.css">',
      '</head>',
      '<body>',
      '  <h1>7 月毛利归因分析</h1>',
      '  <div id="waterfall" data-from="18.4" data-to="16.1"></div>',
      '  <p class="summary">价格因素 -1.6pct · 成本因素 -0.5pct · 结构因素 -0.2pct</p>',
      '  <script src="./waterfall.js"></script>',
      '</body>',
      '</html>'
    ].join('\n')
  },

  /* ---------- 浏览器预览页源码(演示) ---------- */
  pageSource: [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <title>中华人民共和国民法典 · 合同编</title>',
    '</head>',
    '<body>',
    '  <article data-source="npc.gov.cn">',
    '    <h1>第五百八十五条</h1>',
    '    <p>当事人可以约定一方违约时应当根据违约情况向对方支付一定数额的违约金,',
    '       也可以约定因违约产生的损失赔偿额的计算方法。</p>',
    '    <p>约定的违约金低于造成的损失的,人民法院或者仲裁机构可以根据当事人的请求予以增加……</p>',
    '  </article>',
    '</body>',
    '</html>'
  ].join('\n'),

  sessionContext: {
    s1: [
      { type: 'kb', name: '采购合同风险清单', meta: '知识库 · 12 文档 / 486 切片' },
      { type: 'doc', name: 'risk_review_draft.md', meta: '知识库文档 · 审查底稿' },
      { type: 'file', name: '采购框架协议_v4.docx', meta: '项目文件 · 合同文本' },
      { type: 'web', name: '民法典 §585 违约金条款', meta: '网页摘录 · npc.gov.cn' }
    ],
    s2: [
      { type: 'kb', name: '采购合同风险清单', meta: '知识库 · 12 文档 / 486 切片' },
      { type: 'file', name: '供应商补充协议 ×8.zip', meta: '项目文件 · 合同文本' }
    ],
    s6: [
      { type: 'kb', name: '指标口径手册', meta: '知识库 · 8 文档 / 356 切片' },
      { type: 'db', name: 'fact_sales_daily', meta: '数据表 · 华东销售仓' }
    ]
  },

  /* ---------- 项目记忆 ---------- */
  memories: {
    p1: [
      { id: 'mem1', time: '08-19 16:40', source: '任务: 批量审查 8 份补充协议', content: '该项目供应商均为年度框架内伙伴,补充协议审查可复用主协议的风险基线,重点看变更条款。', type: '经验' },
      { id: 'mem2', time: '08-15 11:22', source: '任务: 云服务 SLA 条款比对', content: '公司对云服务可用性的底线为 99.9%,低于该值必须要求服务抵扣条款。', type: '规则' },
      { id: 'mem3', time: '08-12 09:15', source: '手动录入', content: '法务负责人:王律师;重大风险条款需双人复核后方可发出修订意见。', type: '偏好' },
      { id: 'mem4', time: '08-08 17:03', source: '任务: 采购合同首批审查', content: '本项目合同模板存在新旧两版,2025 年前签署的使用旧版违约责任条款,比对时注意区分。', type: '背景' }
    ],
    p3: [
      { id: 'mem1', time: '08-14 10:00', source: '任务: 6 月经营分析', content: '华东区经营分析统一使用管理口径,剔除内部交易与返利暂估。', type: '规则' },
      { id: 'mem2', time: '08-05 15:30', source: '任务: 周报自动化', content: '管理层关注前三指标:毛利率、周转天数、渠道达成率,图表按此优先级排序。', type: '偏好' }
    ]
  },

  /* ---------- 知识库 ---------- */
  knowledgeBases: [
    { id: 'kb1', projectId: 'p1', name: '采购合同风险清单', docs: 12, chunks: 486, updatedAt: '08-16', desc: '历年审查沉淀的风险条款模式与处置建议' },
    { id: 'kb2', projectId: 'p1', name: '法律法规速查', docs: 34, chunks: 2102, updatedAt: '08-10', desc: '民法典合同编、招投标法及司法解释要点' },
    { id: 'kb3', projectId: 'p3', name: '指标口径手册', docs: 8, chunks: 356, updatedAt: '08-12', desc: '管理口径指标定义、取数模板与常见坑' },
    { id: 'kb4', projectId: 'p5', name: '舆情分级标准', docs: 5, chunks: 188, updatedAt: '08-02', desc: '负面信号分级、响应时限与升级路径' },
    { id: 'kb5', projectId: 'p6', name: '发布检查清单库', docs: 6, chunks: 240, updatedAt: '07-30', desc: '各系统发布前必查项与历史故障案例' },
    { id: 'kb6', projectId: 'p8', name: '巡检 SOP 手册', docs: 9, chunks: 402, updatedAt: '08-20', desc: '巡检项定义、阈值口径与处置预案索引' },
    { id: 'kb7', projectId: 'p9', name: '故障案例库', docs: 23, chunks: 1316, updatedAt: '08-18', desc: '历史故障现象、根因与恢复步骤复盘' },
    { id: 'kb8', projectId: 'p10', name: '文书模板与范文库', docs: 41, chunks: 2688, updatedAt: '08-21', desc: '合同与诉讼文书模板、高分范文及条款库' },
    { id: 'kb9', projectId: 'p11', name: '类案判例检索库', docs: 67, chunks: 4520, updatedAt: '08-19', desc: '按争议焦点索引的指导案例与生效判例' }
  ],

  /* ---------- 知识库库内文档(按 kbId 索引,KB 详情页展示) ---------- */
  kbDocs: {
    kb1: [
      { name: '采购合同风险条款模式 v3.doc', type: 'doc', size: '1.2MB', updatedAt: '08-16' },
      { name: '高风险条款处置建议库.md', type: 'md', size: '86KB', updatedAt: '08-15' },
      { name: '账期与付款审查要点.pdf', type: 'pdf', size: '640KB', updatedAt: '08-12' }
    ],
    kb2: [
      { name: '民法典合同编要点摘编.pdf', type: 'pdf', size: '2.4MB', updatedAt: '08-10' },
      { name: '招投标法及司法解释速查.md', type: 'md', size: '120KB', updatedAt: '08-08' }
    ],
    kb3: [
      { name: '指标口径定义手册.md', type: 'md', size: '95KB', updatedAt: '08-12' },
      { name: '毛利取数模板.csv', type: 'csv', size: '34KB', updatedAt: '08-11' }
    ],
    kb4: [
      { name: '负面信号分级标准.md', type: 'md', size: '58KB', updatedAt: '08-02' }
    ],
    kb5: [
      { name: '发布前必查清单.md', type: 'md', size: '72KB', updatedAt: '07-30' }
    ],
    kb6: [
      { name: '服务器巡检 SOP v4.md', type: 'md', size: '110KB', updatedAt: '08-20' },
      { name: '阈值与告警口径表.csv', type: 'csv', size: '28KB', updatedAt: '08-19' },
      { name: '常见异常处置预案.pdf', type: 'pdf', size: '860KB', updatedAt: '08-15' }
    ],
    kb7: [
      { name: '2026H1 故障复盘汇编.pdf', type: 'pdf', size: '3.1MB', updatedAt: '08-18' },
      { name: 'OOM 与磁盘写满根因案例.md', type: 'md', size: '96KB', updatedAt: '08-16' }
    ],
    kb8: [
      { name: '买卖合同模板(2026 修订).doc', type: 'doc', size: '480KB', updatedAt: '08-21' },
      { name: '诉讼文书格式规范.md', type: 'md', size: '64KB', updatedAt: '08-20' },
      { name: '高频条款库.xlsx', type: 'sheet', size: '220KB', updatedAt: '08-18' }
    ],
    kb9: [
      { name: '指导案例要旨汇编 1-24 批.pdf', type: 'pdf', size: '5.6MB', updatedAt: '08-19' },
      { name: '合同纠纷类案索引.csv', type: 'csv', size: '340KB', updatedAt: '08-17' }
    ]
  },

  /* ---------- 数据库连接 ---------- */
  databases: {
    p3: [
      { id: 'db1', name: 'dw_sales_mart', type: 'MySQL', tables: 42, status: 'connected', desc: '销售数据集市(管理口径)' },
      { id: 'db2', name: 'dw_inventory', type: 'PostgreSQL', tables: 18, status: 'connected', desc: '库存与仓储主题库' },
      { id: 'db3', name: 'ods_channel', type: 'ClickHouse', tables: 9, status: 'error', desc: '渠道明细 ODS(凭证已过期)' }
    ],
    p1: [
      { id: 'db4', name: 'contract_archive', type: 'PostgreSQL', tables: 12, status: 'connected', desc: '历史合同归档库(只读)' }
    ]
  },

  /* ---------- 定时任务 ---------- */
  cronJobs: {
    p1: [
      { id: 'cj1', name: '新增合同扫描', schedule: '每日 09:00', agentId: 'a1', enabled: true, lastRun: '今天 09:00', nextRun: '明天 09:00', desc: '扫描归档库新增合同,自动发起审查任务' },
      { id: 'cj2', name: '账期到期提醒', schedule: '每周一 08:30', agentId: 'a4', enabled: true, lastRun: '08-17 08:30', nextRun: '08-24 08:30', desc: '汇总未来 14 天内到期的付款节点' }
    ],
    p3: [
      { id: 'cj3', name: '经营周报生成', schedule: '每周五 17:00', agentId: 'a2', enabled: true, lastRun: '08-14 17:00', nextRun: '08-21 17:00', desc: '取数 → 归因 → 图表 → 推送管理群' },
      { id: 'cj4', name: '数据口径巡检', schedule: '每日 07:30', agentId: 'a2', enabled: false, lastRun: '08-10 07:30', nextRun: '已停用', desc: '校验集市口径与手册一致性' }
    ],
    p5: [
      { id: 'cj5', name: '品牌舆情日报', schedule: '每日 08:00', agentId: 'a3', enabled: true, lastRun: '今天 08:00', nextRun: '明天 08:00', desc: '全网提及聚类研判并推送日报' }
    ]
  },

  /* ---------- 资源消耗 ---------- */
  usage: {
    p1: {
      series: [42, 58, 51, 76, 88, 64, 92, 71, 83, 96, 68, 104, 89, 120],
      days: ['08-06', '08-07', '08-08', '08-09', '08-10', '08-11', '08-12', '08-13', '08-14', '08-15', '08-16', '08-17', '08-18', '08-19'],
      totalTokens: '4.6M', totalCost: '¥ 312.40', avgPerTask: '191K',
      byAgent: [
        { agentId: 'a1', tokens: '3.8M', cost: '¥ 258.10', pct: 82 },
        { agentId: 'a4', tokens: '0.8M', cost: '¥ 54.30', pct: 18 }
      ],
      byModel: [
        { model: 'DeepSeek-V3.2', pct: 88 }, { model: 'Qwen3-235B', pct: 12 }
      ]
    },
    p3: {
      series: [66, 72, 90, 84, 110, 98, 121, 87, 95, 132, 118, 104, 126, 140],
      days: ['08-06', '08-07', '08-08', '08-09', '08-10', '08-11', '08-12', '08-13', '08-14', '08-15', '08-16', '08-17', '08-18', '08-19'],
      totalTokens: '6.8M', totalCost: '¥ 455.60', avgPerTask: '219K',
      byAgent: [
        { agentId: 'a2', tokens: '5.6M', cost: '¥ 374.20', pct: 82 },
        { agentId: 'a5', tokens: '1.2M', cost: '¥ 81.40', pct: 18 }
      ],
      byModel: [
        { model: 'Qwen3-235B', pct: 91 }, { model: 'DeepSeek-V3.2', pct: 9 }
      ]
    }
  },

  /* ---------- 专家跨项目任务记录 ---------- */
  agentTasks: {
    a1: [
      { id: 'at1', project: '采购合同年度审查', title: '审查《2026 年度服务器采购框架协议》', status: 'running', time: '今天 10:31', tokens: '48.2K' },
      { id: 'at2', project: '采购合同年度审查', title: '批量审查 8 份供应商补充协议', status: 'done', time: '昨天 15:20', tokens: '132K' },
      { id: 'at3', project: '投标文件合规核查', title: '智慧城市项目技术标核查', status: 'done', time: '08-18 11:04', tokens: '66K' },
      { id: 'at4', project: '采购合同年度审查', title: 'IDC 机房租赁合同风险复查', status: 'failed', time: '08-18 09:12', tokens: '21.5K' },
      { id: 'at5', project: '投标文件合规核查', title: '商务标废标项扫描', status: 'done', time: '08-16 14:40', tokens: '41K' },
      { id: 'at6', project: '采购合同年度审查', title: '云服务 SLA 条款比对分析', status: 'done', time: '08-15 10:26', tokens: '96K' }
    ],
    a2: [
      { id: 'at1', project: '华东区经营分析', title: '7 月华东区销售毛利归因分析', status: 'running', time: '今天 10:55', tokens: '66.8K' },
      { id: 'at2', project: '华东区经营分析', title: '经营周报(第 33 周)', status: 'done', time: '08-14 17:00', tokens: '88K' },
      { id: 'at3', project: '渠道库存健康度', title: '滞销 SKU 清单与补货建议', status: 'done', time: '08-12 09:30', tokens: '52K' },
      { id: 'at4', project: '华东区经营分析', title: 'Q2 渠道达成率复盘', status: 'done', time: '08-08 16:15', tokens: '74K' }
    ],
    a3: [
      { id: 'at1', project: '品牌舆情日报', title: '今日品牌负面信号研判', status: 'done', time: '今天 08:00', tokens: '58K' },
      { id: 'at2', project: '品牌舆情日报', title: '竞品发布会舆情快报', status: 'done', time: '昨天 20:12', tokens: '36K' }
    ]
  },

  /* ---------- 能力提升(数据回流) ---------- */
  agentGrowth: {
    a1: [
      { id: 'g1', time: '08-19 16:40', from: '批量审查 8 份补充协议', kind: '记忆回流', desc: '沉淀「框架内补充协议复用主协议风险基线」经验,同类任务平均耗时下降 18%。' },
      { id: 'g2', time: '08-15 11:22', from: '云服务 SLA 条款比对分析', kind: '规则沉淀', desc: '新增规则「可用性低于 99.9% 必须要求服务抵扣」,后续命中 3 次。' },
      { id: 'g3', time: '08-08 17:03', from: '采购合同首批审查', kind: '知识更新', desc: '向《采购合同风险清单》回写 2 个新模式:账期超限、违约金不对等。' }
    ],
    a2: [
      { id: 'g1', time: '08-14 17:20', from: '经营周报(第 33 周)', kind: '记忆回流', desc: '沉淀「华东区剔除返利暂估」口径,取数 SQL 复用率提升至 74%。' },
      { id: 'g2', time: '08-05 15:30', from: '周报自动化', kind: '偏好学习', desc: '学习管理层指标排序偏好,图表首屏命中率提升。' }
    ]
  },

  /* ---------- 全局资源(侧边栏用量卡) ---------- */
  quota: { used: 18.6, total: 50, unit: 'M tokens', costMonth: '¥ 1,258.50' },

  /* ---------- 当前用户 / 用户权限(设置页) ---------- */
  user: { name: '沈工', account: 'shen@nebucorp.cn', role: 'admin', avatar: 'assets/avatar.png' },
  users: [
    { id: 'u1', name: '沈工', account: 'shen@nebucorp.cn', role: '管理员', color: '#6C63F0', perms: { workbench: true, projects: true, agents: true, kb: true } },
    { id: 'u2', name: '林悦', account: 'linyue@nebucorp.cn', role: '成员', color: '#4C9AFF', perms: { workbench: true, projects: true, agents: false, kb: false } },
    { id: 'u3', name: '赵铭', account: 'zhaoming@nebucorp.cn', role: '成员', color: '#3FB6B2', perms: { workbench: true, projects: false, agents: false, kb: false } },
    { id: 'u4', name: '陈数', account: 'chenshu@nebucorp.cn', role: '成员', color: '#E09A5B', perms: { workbench: false, projects: false, agents: false, kb: false } }
  ],
  PERM_KEYS: [
    { key: 'workbench', label: '工作台' },
    { key: 'projects', label: '项目' },
    { key: 'agents', label: '专家智能体' },
    { key: 'kb', label: '知识库' }
  ],

  /* ---------- 通知消息(顶栏铃铛) ---------- */
  notifications: [
    { id: 'n1', title: 'DeepSeek-V4-Pro 正式版已上线', date: '08-18', unread: true,
      body: 'NebuWork 已内置最新模型,全部用户可用。会员 Lite 首月仅需 9.9 元,会员 Pro 首月低至 59 元,可获得更多积分。', action: '立即了解' },
    { id: 'n2', title: '接入飞书/微信,随时在聊天中下发任务', date: '08-17', unread: true,
      body: '在通讯工具 @你的办公助手,消息自动转为任务。无需切换应用,直接在聊天中查看结果。', action: '去体验' },
    { id: 'n3', title: '全新积分体系现已上线,享专属模型补贴', date: '07-31', unread: false,
      body: '剩余速通将自动折算为积分,按实际消耗精准抵扣。升级客户端至最新版本,即可体验并领取加赠积分。', action: '查看详情' },
    { id: 'n4', title: '「采购合同年度审查」任务已完成', date: '07-30', unread: false,
      body: '批量合规审查已完成:47 份合同,高风险 3 / 中风险 5 / 提示 8。审查底稿与整改建议清单已生成。', action: '查看任务', link: '#/task/s1' }
  ],

  /* ---------- 扩展(技能 / MCP / 插件):专家与项目共用目录,按 scope 过滤 ---------- */
  extensions: [
    { id: 'x1',  kind: 'skill',  name: '条款风险识别',   desc: '合同条款结构化抽取与风险分级,内置 47 类风险模式。', version: 'v2.4.1', installs: 1280, color: '#6C63F0' },
    { id: 'x2',  kind: 'skill',  name: '经营归因分析',   desc: '指标异动自动归因:价格 / 成本 / 结构三维拆解。', version: 'v1.9.0', installs: 864,  color: '#4C9AFF' },
    { id: 'x3',  kind: 'skill',  name: '舆情情感研判',   desc: '多语言情感极性与传播烈度分级,支持自定义词表。', version: 'v1.5.2', installs: 622,  color: '#3FB6B2' },
    { id: 'x4',  kind: 'mcp',    name: 'MCP · 法规检索', desc: '对接国家法律法规数据库,条文级精确检索。', endpoint: 'npx -y mcp-law-server', version: 'v0.8.3', installs: 1530, color: '#E09A5B' },
    { id: 'x5',  kind: 'mcp',    name: 'MCP · 企业微信', desc: '消息收发与群机器人能力,任务结果直达群聊。', endpoint: 'http://127.0.0.1:8765/sse', version: 'v1.1.0', installs: 940, color: '#E078B0' },
    { id: 'x6',  kind: 'mcp',    name: 'MCP · 知识库同步', desc: 'Obsidian / 语雀知识库双向同步与增量索引。', endpoint: 'npx -y mcp-kb-server', version: 'v0.6.5', installs: 488, color: '#8F7BFF' },
    { id: 'x7',  kind: 'plugin', name: '文档解析',       desc: 'docx / pdf / 扫描件 OCR 解析为结构化文档树。', version: 'v3.2.0', installs: 3210, color: '#6C63F0' },
    { id: 'x8',  kind: 'plugin', name: '图表生成',       desc: '自然语言生成可交互图表,支持瀑布 / 桑基 / 热力。', version: 'v2.1.4', installs: 2760, color: '#4C9AFF' },
    { id: 'x9',  kind: 'plugin', name: '网页浏览',       desc: '受控浏览器访问与正文抽取,留痕可审计。', version: 'v1.7.7', installs: 2980, color: '#3FB6B2' },
    { id: 'x10', kind: 'plugin', name: '钉钉推送',       desc: '审批、预警与日报自动推送到钉钉群。', version: 'v1.3.1', installs: 1850, color: '#E09A5B' }
  ],
  /* 专家已启用扩展:agentId -> extension id 列表 */
  agentExts: {
    a1: ['x1', 'x4', 'x7'], a2: ['x2', 'x8', 'x6'], a3: ['x3', 'x9', 'x10'],
    a4: ['x1', 'x7'], a5: ['x8'], a6: ['x9']
  },
  /* 项目已启用扩展:projectId -> extension id 列表 */
  projectExts: {
    p1: ['x1', 'x4', 'x7', 'x10'], p2: ['x1', 'x7'], p3: ['x2', 'x6', 'x8'],
    p5: ['x3', 'x9', 'x10'], p6: ['x9']
  },

  /* ---------- 广场:案例模板 / 专家智能体市场 ---------- */
  plazaTemplates: [
    { id: 'pt1', name: '合同批量审查流水线', scene: '法务合规', desc: '上传合同包 → 条款比对 → 风险清单 → 修订建议底稿,开箱即用。', uses: 3420, color: '#6C63F0', agents: 2 },
    { id: 'pt2', name: '经营周报自动化', scene: '经营分析', desc: '连接数据集市,每周五自动取数、归因并推送管理群。', uses: 2180, color: '#4C9AFF', agents: 2 },
    { id: 'pt3', name: '品牌舆情值守', scene: '舆情监测', desc: '7×24 全网监测,负面信号分级预警,每日 8 点出日报。', uses: 1960, color: '#3FB6B2', agents: 1 },
    { id: 'pt4', name: '发布前守门', scene: '研发协同', desc: '变更集核验 + 风险分级 + 发布通告起草,拦截高风险发布。', uses: 1210, color: '#B074E8', agents: 1 },
    { id: 'pt5', name: '投标文件核查', scene: '法务合规', desc: '技术标 / 商务标一致性核查与废标项扫描。', uses: 980, color: '#E09A5B', agents: 1 },
    { id: 'pt6', name: '渠道库存巡检', scene: '经营分析', desc: '库存周转与滞销风险周度监测,自动生成补货建议。', uses: 760, color: '#E078B0', agents: 1 },
    { id: 'pt7', name: '数据分析看板', scene: '经营分析', desc: '连接业务数据源,自动生成核心指标看板与异动归因解读,按日推送。', uses: 2650, color: '#4C9AFF', agents: 2 },
    { id: 'pt8', name: '业务系统监控', scene: '系统运维', desc: '关键业务链路可用性与性能指标监控,异常自动定位并生成处置工单。', uses: 1890, color: '#E0645F', agents: 2 },
    { id: 'pt9', name: '客户之声洞察', scene: '客户运营', desc: '汇聚客服会话与评价数据,聚类高频诉求并输出改进建议周报。', uses: 1120, color: '#3FB6B2', agents: 1 },
    { id: 'pt10', name: '投研晨会简报', scene: '行业研究', desc: '隔夜行情、政策与竞品动态自动汇总,开盘前 30 分钟生成晨会简报。', uses: 940, color: '#E09A5B', agents: 2 }
  ],
  /* ---------- 广场 · 共享知识库 ---------- */
  sharedKbs: [
    { id: 'sk1', name: '行业研究方法论库', owner: '启明研究院', field: '行业研究', docs: 56, chunks: 3200, refs: 128, updatedAt: '08-21', desc: '行研框架、数据口径与报告范式,覆盖 12 个重点行业。' },
    { id: 'sk2', name: '法律法规与司法解释库', owner: '正义联盟律所', field: '法务合规', docs: 213, chunks: 18400, refs: 96, updatedAt: '08-20', desc: '民商事高频法规、司法解释与裁判规则,月度更新。' },
    { id: 'sk3', name: '运维故障处置预案库', owner: '云栈科技', field: '系统运维', docs: 88, chunks: 5400, refs: 74, updatedAt: '08-19', desc: '常见故障的定级口径、处置 SOP 与复盘模板。' },
    { id: 'sk4', name: '营销文案风格库', owner: '火山创意', field: '内容生产', docs: 132, chunks: 7600, refs: 63, updatedAt: '08-18', desc: '分行业高分文案范式与品牌语气指南,附效果数据。' },
    { id: 'sk5', name: '财报分析指标口径库', owner: '明镜咨询', field: '经营分析', docs: 44, chunks: 2900, refs: 51, updatedAt: '08-17', desc: '三大报表科目口径、勾稽规则与异常识别特征。' },
    { id: 'sk6', name: '数据治理规范库', owner: '数港科技', field: '数据工程', docs: 37, chunks: 2100, refs: 38, updatedAt: '08-15', desc: '命名规范、血缘管理与质量校验规则集。' }
  ],
  /* ---------- 专家引用的案例模板(agentId → tplIds) ---------- */
  agentTpls: {
    a1: ['pt1'], a2: ['pt2', 'pt7'], a3: ['pt3'], a4: ['pt1', 'pt6'],
    a5: ['pt2'], a6: ['pt4'], a7: ['pt8'], a8: ['pt8'],
    a9: ['pt1', 'pt5'], a10: ['pt5', 'pt10']
  },
  /* ---------- 专家 SOP 集(agentId → SOP 集数组;kind=workflow 工作流编排 / process 标准化流程) ---------- */
  sopSets: {
    a1: [
      {
        id: 'sop-a1-1', name: '经营周报自动生成', kind: 'workflow', desc: '数据拉取→清洗→归因→成稿的全自动周报流水线。', updatedAt: '08-20',
        wf: {
          source: 'ERP 销售/库存数据集 + 财务三表(只读连接)',
          rules: '剔除异常值后按周聚合;环比波动 >±15% 触发异动归因子流程',
          input: '统计周期、业务线范围、对比基准期',
          output: '周报文档(.docx) + 指标看板链接 + 异动清单',
          nodes: [
            { t: '数据拉取', d: '按周期从数据源抽取销售/库存/财务数据' },
            { t: '清洗聚合', d: '异常值剔除、口径对齐、周维度聚合' },
            { t: '异动归因', d: '波动超阈指标下钻业务线,生成归因说明' },
            { t: '报告成稿', d: '套用周报模板成稿并推送订阅人' }
          ]
        }
      },
      {
        id: 'sop-a1-2', name: '月度经营复盘标准流程', kind: 'process', desc: '面向管理层的月度复盘会议材料准备与汇报规范。', updatedAt: '08-12',
        proc: {
          materials: ['经营复盘模板 v3.docx', '2025H1 复盘范例.pdf'],
          specRefs: ['经营分析制度(2025 修订)', '管理汇报口径规范 v2'],
          steps: [
            { t: '数据核对', d: '与财务确认结账口径,核对关键指标一致性', sys: 'ERP 系统', rpa: true },
            { t: '材料起草', d: '按模板起草复盘材料,初稿提交业务负责人确认' },
            { t: '汇报演练', d: '预演汇报问答,整理高频质询问题清单' }
          ]
        }
      }
    ],
    a9: [
      {
        id: 'sop-a9-1', name: '合同起草流水线', kind: 'workflow', desc: '要素采集→条款组装→合规校验→排版输出的合同起草工作流。', updatedAt: '08-22',
        wf: {
          source: '合同模板库 + 交易要素表单 + 法务条款库',
          rules: '金额 >50 万强制引用法务审核条款;违约金条款 ≤ 合同总额 30%',
          input: '交易要素(主体/标的/金额/期限)、合同类型',
          output: '合同初稿(.docx) + 合规校验报告',
          nodes: [
            { t: '要素采集', d: '解析交易要素表单,校验必填项完整性' },
            { t: '条款组装', d: '按合同类型从模板库组装条款,填充要素' },
            { t: '合规校验', d: '套用规则集校验,标红违规条款' },
            { t: '排版输出', d: '按公文规范排版,输出 docx 与校验报告' }
          ]
        }
      },
      {
        id: 'sop-a9-2', name: '诉讼材料整理标准流程', kind: 'process', desc: '诉讼卷宗材料的收集、编目与提交标准作业流程。', updatedAt: '08-15',
        proc: {
          materials: ['诉讼材料清单模板.xlsx', '证据编目规范.pdf'],
          specRefs: ['民事诉讼证据规定', '法院电子卷宗编目指引'],
          steps: [
            { t: '材料收集', d: '按清单收集证据原件扫描件,登记缺失项', sys: '案件管理系统', rpa: true },
            { t: '证据编目', d: '按编目规范编号、撰写证据说明' },
            { t: '提交核验', d: '核对份数与格式,通过诉讼平台提交', sys: '电子诉讼平台' }
          ]
        }
      }
    ],
    a7: [
      {
        id: 'sop-a7-1', name: '服务器巡检工作流', kind: 'workflow', desc: '定时巡检→指标采集→阈值判定→工单派发的自动化巡检。', updatedAt: '08-23',
        wf: {
          source: 'Prometheus 指标 + 主机 Agent 采集(120 台)',
          rules: '磁盘 >80% 预警 / >90% 派单;同告警 10 分钟收敛',
          input: '巡检计划(cron)、主机分组',
          output: '巡检报告 + 异常工单',
          nodes: [
            { t: '指标采集', d: '按计划拉取 CPU/内存/磁盘/网络指标' },
            { t: '阈值判定', d: '套用巡检规则集逐项判定水位' },
            { t: '工单派发', d: '异常项自动生成工单并指派值班人' }
          ]
        }
      }
    ]
  },
  /* ---------- 规则场景集注册表(agentId → 规则集数组,空集也可维护) ---------- */
  ruleSets: {
    a1: [
      { id: 'rs-a1-1', name: '周报口径', desc: '周报数据口径与展示规范' },
      { id: 'rs-a1-2', name: '异常预警', desc: '指标异动阈值与归因要求' }
    ],
    a2: [
      { id: 'rs-a2-1', name: '信息采集', desc: '信息源可信度与交叉验证' },
      { id: 'rs-a2-2', name: '简报生成', desc: '简报时效与降级策略' }
    ],
    a3: [
      { id: 'rs-a3-1', name: '会话分流', desc: '会话优先级识别规则' },
      { id: 'rs-a3-2', name: '会话质检', desc: '回复质检与人工复核触发' }
    ],
    a4: [{ id: 'rs-a4-1', name: '简历筛选', desc: '候选人初筛口径' }],
    a5: [{ id: 'rs-a5-1', name: '代码评审', desc: 'PR 评审红线' }],
    a6: [{ id: 'rs-a6-1', name: '内容合规', desc: '敏感宣称拦截口径' }],
    a7: [
      { id: 'rs-a7-1', name: '巡检', desc: '巡检阈值与派单规则' },
      { id: 'rs-a7-2', name: '告警', desc: '告警收敛与升级策略' },
      { id: 'rs-a7-3', name: '电网无人机缺陷扫描规则', desc: '无人机巡检影像的缺陷识别与分级上报' }
    ],
    a8: [{ id: 'rs-a8-1', name: '日志分析', desc: '日志聚类与派单规则' }],
    a9: [
      { id: 'rs-a9-1', name: '文书起草', desc: '起草阻断与模板引用规则' },
      { id: 'rs-a9-2', name: '合规校验', desc: '条款合规红线' },
      { id: 'rs-a9-3', name: '合同文件审查规则', desc: '合同文本的条款完整性与主体资质审查' },
      { id: 'rs-a9-4', name: '采购文件审查规则', desc: '采购文件资质与预算合规审查' }
    ],
    a10: [{ id: 'rs-a10-1', name: '类案检索', desc: '检索报告判例数量与时效' }]
  },

  /* ---------- 专家业务规则库(agentId → 规则数组,scene 关联规则集名称) ---------- */
  agentRules: {
    a1: [
      { id: 'r-a1-1', name: '周报数据冻结口径', scene: '周报口径', content: '周报数据以每周五 18:00 为冻结时点,之后的变动计入下期报告。', enabled: true, hits: 128, updatedAt: '08-21' },
      { id: 'r-a1-2', name: '缺失数据处理', scene: '周报口径', content: '数据源缺失超过 4 小时的指标以「—」展示并附说明,禁止估算填充。', enabled: false, hits: 12, updatedAt: '08-10' },
      { id: 'r-a1-3', name: '指标异动阈值', scene: '异常预警', content: '核心指标环比波动超过 ±15% 时触发异动标注,并要求输出归因说明。', enabled: true, hits: 36, updatedAt: '08-18' }
    ],
    a2: [
      { id: 'r-a2-1', name: '信息源可信校验', scene: '信息采集', content: '竞品动态优先采集官网公告与主流媒体报道,社交媒体信息需双源交叉验证。', enabled: true, hits: 214, updatedAt: '08-22' },
      { id: 'r-a2-2', name: '晨报时效约束', scene: '简报生成', content: '晨报必须在 08:30 前生成,超过时限自动降级为摘要版并标注原因。', enabled: true, hits: 88, updatedAt: '08-15' }
    ],
    a3: [
      { id: 'r-a3-1', name: '高优先级会话识别', scene: '会话分流', content: '涉及退款、投诉关键词的会话自动标记为高优先级并置顶分配。', enabled: true, hits: 342, updatedAt: '08-23' },
      { id: 'r-a3-2', name: '承诺表述人工复核', scene: '会话质检', content: '回复中包含承诺性时限表述(如「24 小时内必达」)时触发人工复核。', enabled: true, hits: 57, updatedAt: '08-16' }
    ],
    a4: [
      { id: 'r-a4-1', name: '候选人年限过滤', scene: '简历筛选', content: '工作年限与岗位要求差距超过 2 年的候选人自动降级,进入备选池。', enabled: true, hits: 96, updatedAt: '08-12' }
    ],
    a5: [
      { id: 'r-a5-1', name: '数据库变更评审', scene: '代码评审', content: '涉及数据库结构变更的 PR 必须附加回滚方案,否则评审不予通过。', enabled: true, hits: 41, updatedAt: '08-19' }
    ],
    a6: [
      { id: 'r-a6-1', name: '敏感宣称拦截', scene: '内容合规', content: '涉及医疗、金融功效宣称的文案一律拦截并转人工审核。', enabled: true, hits: 73, updatedAt: '08-20' }
    ],
    a7: [
      { id: 'r-a7-1', name: '磁盘水位预警', scene: '巡检', content: '磁盘使用率超过 80% 触发预警,超过 90% 自动升级为处置工单。', enabled: true, hits: 158, updatedAt: '08-23' },
      { id: 'r-a7-2', name: '告警收敛窗口', scene: '告警', content: '同一告警源 10 分钟内重复触发自动收敛为一条,避免告警风暴。', enabled: true, hits: 402, updatedAt: '08-17' },
      { id: 'r-a7-3', name: '缺陷识别置信度阈值', scene: '电网无人机缺陷扫描规则', content: '绝缘子破损、金具锈蚀等缺陷识别置信度 ≥0.85 才自动定级,低于阈值转人工复核。', enabled: true, hits: 236, updatedAt: '08-22' },
      { id: 'r-a7-4', name: '杆塔异物分级上报', scene: '电网无人机缺陷扫描规则', content: '杆塔异物按距导线距离分级:≤1 米紧急上报调度,1-3 米 24 小时内处置,>3 米纳入周计划。', enabled: true, hits: 118, updatedAt: '08-18' }
    ],
    a8: [
      { id: 'r-a8-1', name: '异常聚类派单', scene: '日志分析', content: 'ERROR 级日志聚类后,样本数 Top3 的模式自动生成排查任务。', enabled: true, hits: 64, updatedAt: '08-14' }
    ],
    a9: [
      { id: 'r-a9-1', name: '大额合同法务条款', scene: '文书起草', content: '合同金额超过 50 万元必须引用法务审核条款模板,缺失时阻断生成。', enabled: true, hits: 27, updatedAt: '08-22' },
      { id: 'r-a9-2', name: '违约金上限校验', scene: '合规校验', content: '违约金条款约定不得超过合同总额的 30%,超出时标红并提示修改。', enabled: true, hits: 15, updatedAt: '08-11' },
      { id: 'r-a9-3', name: '条款完整性校验', scene: '合同文件审查规则', content: '合同必须包含主体、标的、价款、履行期限、违约责任五大必备条款,缺失即判定不通过。', enabled: true, hits: 89, updatedAt: '08-23' },
      { id: 'r-a9-4', name: '合同主体资质核验', scene: '合同文件审查规则', content: '签约主体需提供有效营业执照且经营范围内含标的业务,证照临期 30 天内标黄提醒。', enabled: true, hits: 46, updatedAt: '08-19' },
      { id: 'r-a9-5', name: '供应商资质有效期', scene: '采购文件审查规则', content: '供应商资质证书须在有效期内,且近 3 年无重大违法失信记录。', enabled: true, hits: 61, updatedAt: '08-21' },
      { id: 'r-a9-6', name: '采购预算超支预警', scene: '采购文件审查规则', content: '采购报价超过预算 10% 时触发复核流程,需采购委员会书面确认。', enabled: false, hits: 8, updatedAt: '08-09' }
    ],
    a10: [
      { id: 'r-a10-1', name: '类案数量下限', scene: '类案检索', content: '检索报告必须包含近 3 年内至少 5 个有效判例,不足时扩大检索范围并说明。', enabled: true, hits: 33, updatedAt: '08-13' }
    ]
  },
  plazaAgents: [
    { id: 'pa1', name: '合同谈判专家 · 子衿', role: '条款博弈与谈判策略', color: '#6C63F0', installs: 1860, rating: 4.9, tagline: '基于 3000+ 份合同谈判案例沉淀的博弈策略库。' },
    { id: 'pa2', name: '财报解读专家 · 明镜', role: '上市公司财报分析', color: '#4C9AFF', installs: 1520, rating: 4.8, tagline: '三大报表勾稽校验,异常科目自动标注。' },
    { id: 'pa3', name: '招聘筛评专家 · 伯乐', role: '简历筛选与面试题生成', color: '#3FB6B2', installs: 1240, rating: 4.7, tagline: '岗位画像匹配 + 结构化面试题与评估表。' },
    { id: 'pa4', name: '专利检索专家 · 鲁班', role: '专利查新与侵权比对', color: '#E09A5B', installs: 890,  rating: 4.8, tagline: '覆盖中美欧专利库,权利要求逐项比对。' },
    { id: 'pa5', name: '供应链规划专家 · 运筹', role: '需求预测与补货规划', color: '#B074E8', installs: 720,  rating: 4.6, tagline: '多级库存优化,促销弹性系数自学习。' },
    { id: 'pa6', name: '代码评审专家 · 砺锋', role: 'MR 评审与安全扫描', color: '#E078B0', installs: 2030, rating: 4.9, tagline: '按团队规范评审 diff,内嵌 OWASP 检查项。' }
  ],

  /* ---------- 设置 · 频道(IM 接入) ---------- */
  channels: [
    { id: 'dingtalk', name: '钉钉', color: '#4C9AFF', icon: 'message-circle', connected: true,
      desc: '在钉钉群 @办公助手 即可下发任务,审批与预警自动推送。', account: '星云科技 · 全员群' },
    { id: 'feishu', name: '飞书', color: '#3FB6B2', icon: 'send', connected: false,
      desc: '飞书机器人接入,消息卡片交互,任务结果直达会话。', account: '' },
    { id: 'wechat', name: '企业微信', color: '#3FB6B2', icon: 'users', connected: false,
      desc: '企业微信应用消息接入,支持语音转任务。', account: '' }
  ],

  /* ---------- 设置 · 执行体(本地客户端) ---------- */
  executors: [
    { id: 'win', platform: 'Windows', icon: 'monitor-down', version: 'v0.9.2', size: '86 MB', note: 'Windows 10 / 11 (x64)' },
    { id: 'mac', platform: 'macOS', icon: 'monitor-down', version: 'v0.9.2', size: '92 MB', note: 'macOS 12+ (Apple Silicon / Intel)' },
    { id: 'linux', platform: 'Linux', icon: 'terminal', version: 'v0.9.2', size: '78 MB', note: 'Ubuntu 20.04+ / Debian 11+' }
  ],

  /* ---------- 情报中心:订阅源 + 情报条目(region 用于全球信息地图定位) ---------- */
  intelSubs: [
    { id: 'is1', name: '人工智能产业动态', source: '机器之心 / arXiv', cadence: '实时', items: 128, enabled: true },
    { id: 'is2', name: '法律法规更新', source: '国家法律法规数据库', cadence: '每日', items: 42, enabled: true },
    { id: 'is3', name: '招投标市场监测', source: '公开招标平台聚合', cadence: '每小时', items: 356, enabled: true },
    { id: 'is4', name: '供应链风险信号', source: '航运 / 大宗行情', cadence: '每日', items: 67, enabled: false }
  ],
  intelItems: [
    { id: 'it1', title: '多模态大模型推理成本再降 40%', region: '北美', x: 0.22, y: 0.38, heat: 92, time: '10 分钟前', source: '机器之心', tag: 'AI' },
    { id: 'it2', title: '欧盟 AI 法案实施细则公开征求意见', region: '欧洲', x: 0.50, y: 0.30, heat: 78, time: '1 小时前', source: 'EUR-Lex', tag: '法规' },
    { id: 'it3', title: '《数据安全法》配套细则正式施行', region: '中国', x: 0.76, y: 0.42, heat: 88, time: '2 小时前', source: '国家法律法规数据库', tag: '法规' },
    { id: 'it4', title: '东南亚跨境电商物流时效报告发布', region: '东南亚', x: 0.74, y: 0.55, heat: 54, time: '3 小时前', source: '航运监测', tag: '供应链' },
    { id: 'it5', title: '开源 Agent 框架周榜:编排能力成竞争焦点', region: '全球', x: 0.60, y: 0.24, heat: 71, time: '5 小时前', source: 'GitHub Trending', tag: 'AI' },
    { id: 'it6', title: '中东主权基金加注 AI 基础设施', region: '中东', x: 0.60, y: 0.44, heat: 63, time: '8 小时前', source: '财经聚合', tag: '市场' },
    { id: 'it7', title: '南美锂矿出口政策调整影响电池供应链', region: '南美', x: 0.32, y: 0.68, heat: 47, time: '12 小时前', source: '大宗行情', tag: '供应链' },
    { id: 'it8', title: '日本发布生成式 AI 政府采购指引', region: '日本', x: 0.84, y: 0.36, heat: 58, time: '昨天', source: '共同社', tag: '法规' }
  ],
  /* 项目情报:按 projectId 索引(项目内订阅收集) */
  projectIntel: {
    p1: [
      { id: 'pi1', title: '最高法发布合同纠纷典型案例(第 39 批)', time: '今天 09:20', source: '法律法规更新', tag: '法规' },
      { id: 'pi2', title: '《招标投标法实施条例》修订草案公示', time: '昨天 16:05', source: '法律法规更新', tag: '法规' },
      { id: 'pi3', title: '服务器集采中标均价环比降 6.2%', time: '昨天 10:40', source: '招投标市场监测', tag: '市场' },
      { id: 'pi4', title: 'IDC 行业 SLA 标准白皮书(2026)发布', time: '08-18 14:12', source: '人工智能产业动态', tag: '行业' }
    ],
    p3: [
      { id: 'pi5', title: '8 月家电零售景气指数环比 +3.1pct', time: '今天 08:30', source: '大宗行情', tag: '市场' },
      { id: 'pi6', title: '铜价创近三月新高,空调成本承压', time: '昨天 15:22', source: '大宗行情', tag: '供应链' }
    ]
  },

  /* ---------- 指挥官:对话 + 调度 + 主智能体记忆节点 ---------- */
  commander: {
    messages: [
      { id: 'cm1', role: 'agent', time: '09:30', content: '早上好,沈工。今天有 3 个运行中任务、1 个失败待处理:「IDC 机房租赁合同风险复查」已失败,需要我重新调度吗?' },
      { id: 'cm2', role: 'user', time: '09:32', content: '先不用,帮我看看本周资源消耗有没有异常。' },
      { id: 'cm3', role: 'agent', time: '09:32', content: '本周累计消耗 12.6M tokens,环比 +18%,主要来自「华东区经营分析」的周报批量生成。属于正常业务高峰,无需干预。' }
    ],
    dispatch: [
      { id: 'cd1', title: '审查《2026 年度服务器采购框架协议》', agentId: 'a1', projectId: 'p1', status: 'running', progress: 68, time: '10:42' },
      { id: 'cd2', title: '7 月华东区销售毛利归因分析', agentId: 'a2', projectId: 'p3', status: 'running', progress: 82, time: '11:05' },
      { id: 'cd3', title: '今日品牌负面信号研判', agentId: 'a3', projectId: 'p5', status: 'done', progress: 100, time: '08:00' },
      { id: 'cd4', title: 'IDC 机房租赁合同风险复查', agentId: 'a1', projectId: 'p1', status: 'failed', progress: 34, time: '08-18' }
    ],
    /* 球状节点图:label=节点名,kind=center/agent/memory,size 权重 */
    memNodes: [
      { id: 'mn0', label: '主智能体', kind: 'center' },
      { id: 'mn1', label: '明察', kind: 'agent' }, { id: 'mn2', label: '观澜', kind: 'agent' },
      { id: 'mn3', label: '闻涛', kind: 'agent' }, { id: 'mn4', label: '钧衡', kind: 'agent' },
      { id: 'mn5', label: '丹青', kind: 'agent' }, { id: 'mn6', label: '守门', kind: 'agent' },
      { id: 'mn7', label: '合同风险基线', kind: 'memory' }, { id: 'mn8', label: '管理口径规则', kind: 'memory' },
      { id: 'mn9', label: '舆情分级标准', kind: 'memory' }, { id: 'mn10', label: '发布检查清单', kind: 'memory' },
      { id: 'mn11', label: 'SLA 底线 99.9%', kind: 'memory' }, { id: 'mn12', label: '管理层指标偏好', kind: 'memory' }
    ]
  }
};
