#!/usr/bin/env python3

import base64
import json
import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def data_uri(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    mime = "image/bmp" if path.suffix.lower() == ".bmp" else "application/octet-stream"
    return f"data:{mime};base64,{encoded}"


def main() -> int:
    root = Path(__file__).resolve().parent
    manifest_path = root / "plugin.json"
    script_path = root / "script.js"
    web_index_path = root / "web" / "index.html"
    panel_asset = root / "assets" / "original-panel.bmp"
    help_asset = root / "assets" / "original-help.bmp"
    monk_strip_asset = root / "assets" / "original-monk-strip.bmp"
    fader_right_sm_asset = root / "assets" / "original-fader-right-sm.bmp"
    fader_down_sm_asset = root / "assets" / "original-fader-down-sm.bmp"
    fader_down_large_asset = root / "assets" / "original-fader-down-large.bmp"
    knob_left_asset = root / "assets" / "original-knob-left.bmp"
    knob_right_asset = root / "assets" / "original-knob-right.bmp"

    if not manifest_path.is_file():
        print(f"missing {manifest_path}", file=sys.stderr)
        return 1
    if not script_path.is_file():
        print(f"missing {script_path}", file=sys.stderr)
        return 1
    if not web_index_path.is_file():
        print(f"missing {web_index_path}", file=sys.stderr)
        return 1
    if not panel_asset.is_file():
        print(f"missing {panel_asset}", file=sys.stderr)
        return 1
    if not help_asset.is_file():
        print(f"missing {help_asset}", file=sys.stderr)
        return 1
    if not monk_strip_asset.is_file():
        print(f"missing {monk_strip_asset}", file=sys.stderr)
        return 1
    if not fader_right_sm_asset.is_file():
        print(f"missing {fader_right_sm_asset}", file=sys.stderr)
        return 1
    if not fader_down_sm_asset.is_file():
        print(f"missing {fader_down_sm_asset}", file=sys.stderr)
        return 1
    if not fader_down_large_asset.is_file():
        print(f"missing {fader_down_large_asset}", file=sys.stderr)
        return 1
    if not knob_left_asset.is_file():
        print(f"missing {knob_left_asset}", file=sys.stderr)
        return 1
    if not knob_right_asset.is_file():
        print(f"missing {knob_right_asset}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    plugin_type = manifest.get("manifest", {}).get("type")
    plugin_name = manifest.get("manifest", {}).get("name", "plugin")
    extension = ".ntins" if plugin_type == "instrument" else ".ntsfx"
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", plugin_name).strip("-") or "plugin"

    rendered_web = web_index_path.read_text(encoding="utf-8")
    rendered_web = rendered_web.replace("__ORIGINAL_PANEL_DATA__", data_uri(panel_asset))
    rendered_web = rendered_web.replace("__ORIGINAL_HELP_DATA__", data_uri(help_asset))
    rendered_web = rendered_web.replace("__ORIGINAL_MONK_STRIP_DATA__", data_uri(monk_strip_asset))
    rendered_web = rendered_web.replace("__ORIGINAL_FADER_RIGHT_SM_DATA__", data_uri(fader_right_sm_asset))
    rendered_web = rendered_web.replace("__ORIGINAL_FADER_DOWN_SM_DATA__", data_uri(fader_down_sm_asset))
    rendered_web = rendered_web.replace("__ORIGINAL_FADER_DOWN_LARGE_DATA__", data_uri(fader_down_large_asset))
    rendered_web = rendered_web.replace("__ORIGINAL_KNOB_LEFT_DATA__", data_uri(knob_left_asset))
    rendered_web = rendered_web.replace("__ORIGINAL_KNOB_RIGHT_DATA__", data_uri(knob_right_asset))

    dist_dir = root / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    archive_path = dist_dir / f"{safe_name}{extension}"

    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
        archive.write(manifest_path, arcname="plugin.json")
        archive.write(script_path, arcname="script.js")
        archive.writestr("web/index.html", rendered_web)

    print(archive_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
