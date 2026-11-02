"""Disposable HTTP/UI test project; never uses real workflows or runtime data."""
from pathlib import Path
import os
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn
from nebulae.api import create_app
from wheels import wheel
from agent_model import model_server

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="nebulae-e2e-") as project, model_server() as (model_url, _):
        os.environ['NEBULAE_AGENT_RUNTIME'] = str(Path(__file__).resolve().parents[1] / 'nebulae/agent_runtime')
        app = create_app(project)
        from nebulae.agent_runtime import DEFAULTS
        settings = {k: v for k, v in DEFAULTS.items() if k != 'version'}
        settings.update(base_url=model_url, model='fixture')
        app.state.agent_service.configure(settings, '', 0, 'e2e-model')
        app.state.engine.catalog.create("environment-acceptance", "独立环境验收")
        root = app.state.engine.catalog.directory("environment-acceptance")
        package = wheel(root, "1.0")
        (root / "requirements.txt").write_text("--no-index\n./" + package + "\n", encoding="utf-8")
        (root / "main.py").write_text("def run(ctx):\n    import nebulae_env_fixture\n    ctx.task.save_text('version', nebulae_env_fixture.VERSION)\n", encoding="utf-8")
        uvicorn.run(app, host=os.environ.get("NEBULAE_E2E_HOST", "127.0.0.1"),
                    port=int(os.environ.get("NEBULAE_E2E_PORT", "18765")), log_level="warning")
