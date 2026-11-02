import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=process.argv[2]||process.env.NEBU_PLATFORM_MCP_CATALOG;
if(!source)throw Error('Pass the Java platform-mcp-catalog.json path as the first argument or set NEBU_PLATFORM_MCP_CATALOG.');
const catalog=JSON.parse(await readFile(source,'utf8'));
if(catalog.tools.length!==172||new Set(catalog.tools.map(t=>t.name)).size!==172)throw Error('Unexpected platform catalog; review coverage before exporting');
const sources={platform:'PlatformMcpService / PlatformMcpDispatch 聚合',workbench:'WorkbenchService',project:'WorkbenchService',runtime:'RuntimeResources',expert:'ExpertService / ExpertAbilityService',market_expert:'ExpertService',sop:'ExpertService / WorkflowService',sop_material:'ExpertService',rule_set:'ExpertService',rule:'ExpertService',extension_catalog:'ExpertService',case_template:'ExpertService',task:'AgentTasks / AgentClient',session:'AgentClient / engine Store',artifact:'AgentTasks / AgentClient',workflow:'WorkflowService',workflow_task:'WorkflowService',workflow_artifact:'WorkflowService',knowledge:'KnowledgeService',knowledge_library:'KnowledgeService / KnowledgeManagement',knowledge_document:'KnowledgeManagement / KnowledgeContent',faq:'KnowledgeManagement / PlatformMcpFaqFiles',knowledge_tag:'KnowledgeManagement',wiki_page:'KnowledgeManagement',wiki_folder:'KnowledgeManagement',wiki:'KnowledgeManagement',knowledge_creation:'KnowledgeCreationService',knowledge_creation_job:'KnowledgeCreationService',knowledge_operation:'KnowledgeManagement',evidence:'KnowledgeEvidence / KnowledgeContent',memory:'MemoryService / MemoryRuntime',model:'ModelProviderService',admin:'原模块管理服务（各自管理员检查）'};
const escape=s=>String(s).replaceAll('|','\\|').replaceAll('\n',' ');
const type=s=>s.anyOf?s.anyOf.map(type).join(' / '):s.enum?`${s.type} (${s.enum.join(' / ')})`:s.type==='array'?`array<${s.items?.type||'业务对象'}>`:s.type||'JSON';
let md=`# 系统 MCP 工具目录 v${catalog.version}\n\n本文件由 Java 工具注册表导出，共 ${catalog.tools.length} 个工具。重新导出：先运行 Java 的 PlatformMcpAdapterTest，再运行 \`node scripts/export-platform-mcp-tools.mjs <Java导出JSON路径>\`。完整嵌套 Schema 见 [platform-mcp-catalog.json](platform-mcp-catalog.json)。\n\n所有工具仅供可信 Worker 使用。每次调用都校验真实 Run、工作台冻结授权与当前授权的交集、原业务账号/资源权限。\n\n成功统一返回 \`{ data, operationId }\`：\`data\` 为下列原业务服务的脱敏返回投影；\`operationId\` 为持久化调用编号。结果超过 256 KiB 时返回受控资源与 \`truncated:true\`，通过 \`nw_resource_read\` 分段读取。列表的具体分页字段沿用业务服务；新增聚合列表使用 \`items/hasMore/nextOffset\`。空、未知、部分结果、不可用分别保留业务状态。\n\n通用错误：401 运行凭证失效；403 工具/数据范围或原业务授权不足；404 对象不可见或不存在；409 版本冲突、目录变化或原操作结果待核对；413 大小限制；422 参数或能力不支持；502/503 上游不可用。MCP 以 \`isError\` 返回业务错误。\n\n恢复列：read=同编号复用原结果且重新授权；idempotent=本地业务和成功台账在同一事务，重复编号不重复写入；reconcile=优先读取原业务回执，不自动重新创建未知的外部操作。所有恢复均重新检查当前权限；同编号不同参数拒绝。\n\n`;
for(const [group,source] of Object.entries(sources)){
  const tools=catalog.tools.filter(t=>(t.group||'platform')===group);if(!tools.length)continue;
  md+=`## ${group}（${tools.length} 项）\n\n业务来源：${source}。适配入口：Java \`platformmcp/PlatformMcpDispatch\`。\n\n`;
  for(const tool of tools){
    const properties=tool.inputSchema.properties,required=new Set(tool.inputSchema.required||[]);
    md+=`### ${tool.name}\n\n${tool.description}。性质：${tool.write?'写入 / 执行':'只读'}；恢复：${tool.replay}。所需工具授权：\`${tool.name}\`，另叠加目标对象的范围和业务权限。\n\n`;
    if(Object.keys(properties).length){md+='| 参数 | 类型 | 必需 | 说明 |\n|---|---|---|---|\n';for(const [key,s] of Object.entries(properties))md+=`| ${key} | ${escape(type(s))} | ${required.has(key)?'是':'否'} | ${escape(s.description||key)} |\n`;md+='\n';}
    else md+='无模型输入参数，身份由真实运行推导。\n\n';
    if(properties.data?.properties){md+='业务字段：'+Object.entries(properties.data.properties).map(([k,s])=>`\`${k}\` (${escape(type(s))})`).join('、')+'。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。\n\n';}
    md+=`返回：\`data\` 包含${tool.description}的业务结果，来自 ${sources[group]}；文件与原图返回受控 \`uri\`，不包含上游地址或密钥。\n\n`;
  }
}
md+='## 特定边界\n\n- `save` 的 `mode` 为 create/update；更新传 id 和当前版本。共享专家、SOP、规则的变更会返回实际共享影响范围。\n- 新建工作台/专家/独立工作流/知识库、市场添加、创建作业、跨项目专家/工作台总用量需要主执行的账号范围。指定资源不会授予其连接配置或其他账号数据。\n- `nw_task_create` 必须指定现有目标项目，目标项目决定工作台；不创建隐蔽项目。派生任务和专家不能再次进行业务任务调度。任务元数据不授予会话正文，跨任务内容只能通过已有会话授权读取。\n- `nw_runtime_save.data.files` 仅接受保留的已有文件 path；新文件用 `nw_runtime_file_add`。MCP 地址、凭据和策略是保留字段。\n- `nw_faq_import` 支持 data.entries，或受控 file 加 format=json/csv；两者互斥。CSV 沿用现有中英文模板列和引号/多行语义。\n- `nw_memory_propose.data.sourceEntryId` 可关联已有记忆形成修改或提升建议；始终产生有真实 Run 来源的新草稿。`nw_memory_draft_update` 保留待审核状态，审核发布继续由人完成。\n- `nw_resource_read` 的 limit 最多 65536。二进制 offset 按字节，JSON 文本 offset 按字符串位置；跟随 nextOffset。MCP resources/read 对未读完的内容返回带 continuation 的 JSON 描述，避免把首段误认为完整文件。\n- 管理查询仍执行各模块管理员检查；普通模板目录不包含技术配置。暂缺业务、人工审核/授权、连接和密钥维护不注册工具。\n';
await writeFile(resolve(root,'docs/platform-mcp-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
await writeFile(resolve(root,'docs/platform-mcp-tools.md'),md);
console.log(`Exported ${catalog.tools.length} platform tools from Java catalog v${catalog.version}`);
