"""Read distribution metadata without pip or importing business packages."""
import importlib.metadata
import json
import os
import re
import sys
import time


def inspect_environment():
    packages = {}
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name")
        if name:
            key = re.sub(r"[-_.]+", "-", name).lower()
            packages.setdefault(key, {"name": name, "version": distribution.version})
    return {"interpreter": os.path.abspath(sys.executable), "python_version": sys.version.split()[0],
            "packages": [packages[k] for k in sorted(packages)], "package_count": len(packages),
            "observed_at": time.time()}


if __name__ == "__main__":
    info = inspect_environment()
    if "--sdk" in sys.argv:
        from pathlib import Path
        import runpy
        runpy.run_path(str(Path(__file__).with_name("_bootstrap.py")))["load_sdk"]()
        import nebulae._worker  # Verify SDK availability; never import workflow code.
    print(json.dumps(info, ensure_ascii=True))
