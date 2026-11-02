"""Load only this SDK package, never its containing service site-packages directory."""
import importlib.util
from pathlib import Path
import runpy
import sys


def load_sdk():
    directory = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location("nebulae", directory / "__init__.py",
                                                submodule_search_locations=[str(directory)])
    package = importlib.util.module_from_spec(spec)
    sys.modules["nebulae"] = package
    spec.loader.exec_module(package)


if __name__ == "__main__":
    entry = sys.argv.pop(1)
    if entry not in {"_worker", "_environment_worker", "_mcp_http_worker"}:
        raise ValueError("Unknown internal worker")
    load_sdk()
    runpy.run_module("nebulae." + entry, run_name="__main__")
