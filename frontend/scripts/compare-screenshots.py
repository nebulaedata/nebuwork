from pathlib import Path
from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".qa" / "update-reference"
IMPLEMENTATION = ROOT / ".qa" / "update-implementation"
OUTPUT = ROOT / ".qa" / "update-comparison"
STATES = ["pro-list", "pro-config", "agent-sop", "agent-rules", "agent-rule-modal"]

OUTPUT.mkdir(parents=True, exist_ok=True)

for state in STATES:
    source = Image.open(SOURCE / f"{state}.jpg").convert("RGB")
    implementation = Image.open(IMPLEMENTATION / f"{state}.jpg").convert("RGB")
    if source.size != implementation.size:
        raise SystemExit(f"{state}: size mismatch {source.size} != {implementation.size}")

    difference = ImageChops.difference(source, implementation)
    changed = sum(1 for pixel in difference.get_flattened_data() if pixel != (0, 0, 0))
    total = source.width * source.height

    comparison = Image.new("RGB", (source.width * 2, source.height), "white")
    comparison.paste(source, (0, 0))
    comparison.paste(implementation, (source.width, 0))
    comparison.save(OUTPUT / f"{state}.png")

    print(f"{state}: changed={changed}/{total} ({changed / total:.6%})")
