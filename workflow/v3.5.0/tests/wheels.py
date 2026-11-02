"""Tiny offline distributions for core and browser acceptance tests."""
import zipfile


def wheel(root, version, requires=None, startup=None):
    name = f"nebulae_env_fixture-{version}-py3-none-any.whl"
    metadata = f"nebulae_env_fixture-{version}.dist-info"
    with zipfile.ZipFile(root / name, "w") as out:
        out.writestr("nebulae_env_fixture.py", f"VERSION = {version!r}\n")
        text = f"Metadata-Version: 2.1\nName: nebulae-env-fixture\nVersion: {version}\n"
        if requires:
            text += f"Requires-Dist: {requires}\n"
        out.writestr(metadata + "/METADATA", text)
        out.writestr(metadata + "/WHEEL", "Wheel-Version: 1.0\nGenerator: test\nRoot-Is-Purelib: true\nTag: py3-none-any\n")
        out.writestr(metadata + "/RECORD", "")
        if startup:
            out.writestr("nebulae_env_fixture.pth", startup + "\n")
    return name
