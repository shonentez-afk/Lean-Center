"""Create and verify a deterministic deployment-only ZIP. No user data."""
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path("dist/LeanCenter")
OUT = Path("releases/LeanCenter-LC5.0-dev.zip")
manifest = json.loads((ROOT / "app-manifest.json").read_text(encoding="utf-8"))
assert manifest["entry"] == "index.html"
expected = {item["path"]: item for item in manifest["files"]}
assert len(expected) == len(manifest["files"])
for name, item in expected.items():
    p = PurePosixPath(name)
    assert not p.is_absolute() and ".." not in p.parts
    assert name in {"index.html", "README_DEPLOY_RU.txt"} or name.startswith("versions/" + manifest["version"] + "/")
    data = (ROOT / name).read_bytes()
    assert len(data) == item["size"] and hashlib.sha256(data).hexdigest() == item["sha256"], name
names = sorted([*expected, "app-manifest.json"])
assert {p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*") if p.is_file()} == set(names)
OUT.parent.mkdir(exist_ok=True)
with ZipFile(OUT, "w", compression=ZIP_DEFLATED, compresslevel=9) as z:
    for name in names:
        info = ZipInfo("LeanCenter/" + name, date_time=(2026, 11, 25, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        z.writestr(info, (ROOT / name).read_bytes(), compresslevel=9)
with ZipFile(OUT) as z:
    assert z.testzip() is None
    assert z.namelist() == ["LeanCenter/" + n for n in names]
    for name in names:
        assert z.read("LeanCenter/" + name) == (ROOT / name).read_bytes(), name
print(f"Deployment ZIP: {OUT}, {OUT.stat().st_size} bytes, SHA256={hashlib.sha256(OUT.read_bytes()).hexdigest()}")
