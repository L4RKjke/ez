import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CATALOG_ROOT = PROJECT_ROOT / "vtx_catalog"

CATALOG_ROOT.mkdir(parents=True, exist_ok=True)

folders = sorted(
    (
        directory.name
        for directory in CATALOG_ROOT.iterdir()
        if directory.is_dir()
        and (directory / "описание.json").is_file()
    ),
    key=str.casefold,
)

index_path = CATALOG_ROOT / "index.json"

index_path.write_text(
    json.dumps(folders, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)

print(f"Каталог обновлён: {len(folders)} передатчиков.")
print(f"Файл: {index_path}")
