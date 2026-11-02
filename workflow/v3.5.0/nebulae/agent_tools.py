"""Server-enforced per-workflow scope around the shared tool catalog."""
import asyncio
import time
from typing import Annotated, Any
from pydantic import Field

from .tool_catalog import ToolError
from .workflow_tools import READ, Identifier, workflow_tools


class ScopedTools:
    def __init__(self, engine, workflow_id, base_url, stop, *, client=None):
        self.engine, self.workflow_id, self.stop = engine, workflow_id, stop
        self.catalog = workflow_tools(base_url, client=client)

        @self.catalog.tool(annotations=READ)
        async def task_wait(task_id: Identifier, seconds: Annotated[int, Field(ge=1, le=60)] = 30) -> dict[str, Any]:
            """等待任务状态变化或完成（最多60秒）；可中断，不开始/恢复任务。未完成可继续等待。"""
            return await self.wait('task_get', {'task_id': task_id}, seconds,
                                   {'succeeded', 'failed', 'cancelled', 'paused', 'waiting_manual'})

        @self.catalog.tool(annotations=READ)
        async def environment_wait(operation_id: Identifier, seconds: Annotated[int, Field(ge=1, le=60)] = 30) -> dict[str, Any]:
            """等待环境操作完成或失败（最多60秒）；可中断，不提交新的安装操作。"""
            return await self.wait('environment_operation_get', {'operation_id': operation_id}, seconds,
                                   {'succeeded', 'failed', 'interrupted'})

    async def wait(self, name, arguments, seconds, terminal):
        deadline = time.monotonic() + seconds
        while True:
            if self.stop.is_set():
                raise ToolError('助手已停止；已提交的任务/安装继续由执行核心管理')
            result = await self.catalog.call(name, arguments)
            if result['state'] in terminal or time.monotonic() >= deadline:
                return result
            await asyncio.sleep(.5)

    def validate(self, name, arguments):
        args = self.catalog.validate(name, arguments)
        workflow = args.get('workflow_id')
        if workflow is not None and workflow != self.workflow_id:
            raise ToolError('会话只能操作绑定的工作流')
        if args.get('copy_from') not in (None, self.workflow_id):
            raise ToolError('会话不能读取或复制其他工作流')
        if args.get('task_id'):
            if self.engine.status(args['task_id'])['workflow_id'] != self.workflow_id:
                raise ToolError('任务不属于当前会话的工作流')
        if args.get('artifact_id'):
            if self.engine.artifact(args['artifact_id'])['workflow_id'] != self.workflow_id:
                raise ToolError('产物不属于当前会话的工作流')
        if args.get('operation_id'):
            rows = self.engine.store.read('SELECT workflow_id FROM environment_operations WHERE id=?', (args['operation_id'],))
            if not rows or rows[0]['workflow_id'] != self.workflow_id:
                raise ToolError('环境操作不属于当前会话的工作流')
        if name == 'task_list':
            args['workflow_id'] = self.workflow_id
        return args

    async def call(self, name, arguments):
        args = self.validate(name, arguments)
        if self.stop.is_set():
            raise ToolError('助手已停止，未派发此工具')
        if name == 'workflow_list':
            rows = self.engine.catalog.list()
            return {'workflows': [w for w in rows if w['id'] == self.workflow_id]}
        return await self.catalog.call(name, args)
