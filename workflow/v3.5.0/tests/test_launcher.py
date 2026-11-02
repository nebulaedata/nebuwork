import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("workflow_launcher", Path(__file__).resolve().parents[1] / "start_workflow.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def test_existing_runtime_is_selected_without_opening_or_changing_database(tmp_path):
    runtime = tmp_path / "existing"
    runtime.mkdir()
    database = runtime / "state.sqlite3"
    database.write_bytes(b"existing database must not be opened by path resolution")
    (tmp_path / ".env").write_text(f"NEBULAE_RUNTIME_DIR={runtime}\nNEBULAE_PORT=8765\nNEBULAE_SERVICE_API_KEY=private-key\n")
    settings = launcher.resolve_settings(tmp_path, {"NEBULAE_PORT": "18888"})
    assert settings["runtime"] == runtime
    assert settings["project"] == tmp_path
    assert settings["port"] == 18888
    assert settings["env"]["NEBULAE_SERVICE_API_KEY"] == "private-key"
    assert database.read_bytes() == b"existing database must not be opened by path resolution"


def test_missing_existing_runtime_fails_without_creating_an_empty_database(tmp_path):
    with pytest.raises(ValueError, match="missing"):
        launcher.resolve_settings(tmp_path, {"NEBULAE_RUNTIME_DIR": str(tmp_path / "absent")})
    assert not (tmp_path / "absent").exists()


def test_isolated_launch_ignores_private_config_and_keeps_existing_runtime_untouched(tmp_path):
    original = tmp_path / "original"
    original.mkdir()
    (original / "state.sqlite3").write_bytes(b"preserved")
    demo = tmp_path / "workflows" / "demo"
    demo.mkdir(parents=True)
    (demo / "workflow.json").write_text('{"name":"demo"}')
    (tmp_path / ".env").write_text(f"NEBULAE_RUNTIME_DIR={original}\nNEBULAE_REMOTE_ACCESS=true\nNEBULAE_SERVICE_API_KEY=production-key\n")
    settings = launcher.resolve_settings(tmp_path, {}, isolated=True, port=18768)
    assert settings["runtime"].is_relative_to(tmp_path / ".qa")
    assert settings["project"] != tmp_path
    assert (settings["project"] / "workflows" / "demo" / "workflow.json").is_file()
    assert not (settings["runtime"] / "state.sqlite3").exists()
    assert settings["remote_access"] is False
    assert "NEBULAE_SERVICE_API_KEY" not in settings["env"]
    assert (original / "state.sqlite3").read_bytes() == b"preserved"
