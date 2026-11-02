"""Local API for the optional workflow assistant."""
import asyncio
from typing import Literal

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .store import encode


class Body(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Command(Body):
    command_id: str = Field(min_length=1, max_length=100)


class Control(Command):
    expected_version: int = Field(ge=0, strict=True)


class Settings(Control):
    base_url: str = Field(max_length=2000)
    model: str = Field(min_length=1, max_length=200)
    api: Literal['openai-completions', 'openai-responses'] = 'openai-completions'
    api_key: str | None = Field(default=None, max_length=4000)
    node_path: str = Field(default='', max_length=1000)
    context_window: int = Field(default=128000, ge=8192, le=2000000)
    max_tokens: int = Field(default=8192, ge=256, le=200000)


class NewSession(Command):
    workflow_id: str
    title: str = Field(default='工作流构建', min_length=1, max_length=200)
    new_workflow: bool = False


class Message(Control):
    text: str = Field(min_length=1, max_length=100000)


def register_agent_routes(app, service):
    base = '/api/v1/agent'

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        if request.url.path == base + '/settings':
            return JSONResponse(status_code=422, content={'detail': [
                {k: v for k, v in error.items() if k not in {'input', 'ctx'}} for error in exc.errors()]})
        return await request_validation_exception_handler(request, exc)

    @app.get(base + '/settings')
    def settings():
        return service.config()

    @app.put(base + '/settings')
    def save_settings(body: Settings):
        values = body.model_dump(exclude={'api_key', 'expected_version', 'command_id'})
        return service.configure(values, body.api_key, body.expected_version, body.command_id)

    @app.get(base + '/runtime')
    def runtime():
        return service.status()

    @app.post(base + '/check')
    def check(request: Request):
        return service.check(str(request.base_url).rstrip('/'))

    @app.get(base + '/sessions')
    def sessions(workflow_id: str | None = None):
        return service.sessions(workflow_id)

    @app.post(base + '/sessions', status_code=201)
    def create_session(body: NewSession):
        return service.create_session(**body.model_dump())

    @app.get(base + '/sessions/{session_id}')
    def session(session_id: str):
        return service.session(session_id)

    @app.post(base + '/sessions/{session_id}/messages', status_code=202)
    def message(session_id: str, body: Message, request: Request):
        return service.submit(session_id, **body.model_dump(), base_url=str(request.base_url).rstrip('/'))

    @app.post(base + '/sessions/{session_id}/stop')
    def stop(session_id: str, body: Control):
        return service.stop(session_id, **body.model_dump())

    @app.get(base + '/sessions/{session_id}/events')
    def events(session_id: str, after: int = 0, limit: int = 500):
        return service.events(session_id, max(0, after), max(1, min(limit, 500)))

    @app.get(base + '/sessions/{session_id}/stream')
    async def stream(session_id: str, request: Request, after: int = 0, follow: bool = True):
        service.session_exists(session_id)
        cursor = max(after, int(request.headers.get('last-event-id', '0')))
        async def generate():
            nonlocal cursor
            while not await request.is_disconnected():
                rows = await asyncio.to_thread(service.events, session_id, cursor)
                for row in rows:
                    cursor = row['id']
                    yield f'id: {cursor}\ndata: {encode(row)}\n\n'
                if not follow:
                    break
                if not rows:
                    yield ': heartbeat\n\n'
                    await asyncio.sleep(.4)
        return StreamingResponse(generate(), media_type='text/event-stream',
                                 headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
