"""Inspect the exact distribution artifact on Linux. Usage: audit-appimage.py IMAGE EVIDENCE"""

import configparser
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
BASELINE = (2, 35)  # Ubuntu 22.04


def run(*args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True,
                            env={**os.environ, "LC_ALL": "C"}, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{args[0]} exited {result.returncode}: "
                           f"{(result.stdout + result.stderr)[-4000:]}")
    return result.stdout


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def elf_info(path):
    with path.open("rb") as handle:
        if handle.read(4) != b"\x7fELF":
            return None
    output = run("readelf", "--wide", "--program-headers", "--dynamic", "--version-info", path)
    # Only imported versions constrain the host. A definition or symbol name
    # containing "GLIBC" is not a version requirement.
    needs = output.partition("Version needs section")[2]
    versions = sorted({
        tuple(map(int, value.split(".")))
        for value in re.findall(r"Name: GLIBC_([0-9]+(?:\.[0-9]+)+)\b", needs)
    })
    interpreter = re.search(r"Requesting program interpreter: ([^\]]+)", output)
    return {
        "glibc": [".".join(map(str, version)) for version in versions],
        "other_glibc_abi": re.findall(r"Name: (GLIBC_[A-Za-z][^\s]*)", needs),
        "interpreter": interpreter[1] if interpreter else None,
        "needed": re.findall(r"\(NEEDED\).*?\[(.*?)\]", output),
        "search_paths": re.findall(r"\((?:RPATH|RUNPATH)\).*?\[(.*?)\]", output),
    }


def check_desktop(appdir, evidence):
    entries = list(appdir.glob("*.desktop"))
    require(len(entries) == 1, "Expected exactly one root desktop entry")
    desktop = entries[0]
    installed = appdir / "usr/share/applications" / desktop.name
    require(installed.read_bytes() == desktop.read_bytes(), "Installed desktop entry differs")
    run("desktop-file-validate", desktop)
    meta = appdir / "usr/share/metainfo/io.github.swiph3l.chatplus-desktop.appdata.xml"
    run("appstreamcli", "validate", "--no-net", meta)
    component = ET.parse(meta).getroot()
    require(component.findtext("id") == "io.github.swiph3l.chatplus-desktop"
            and component.findtext("name") == "Chat+ Desktop"
            and component.findtext("launchable[@type='desktop-id']") == desktop.name,
            "AppStream application identity does not match the desktop launcher")
    config = configparser.ConfigParser(interpolation=None)
    config.read(desktop)
    entry = config["Desktop Entry"]
    expected = {"Name": "Chat+ Desktop", "Type": "Application", "Terminal": "false",
                "Exec": "chatplus-desktop", "StartupWMClass": "chatplus-desktop"}
    for key, value in expected.items():
        require(entry.get(key) == value, f"Unexpected desktop {key}: {entry.get(key)}")
    require("Network" in entry["Categories"].split(";"), "Missing Network category")
    name = entry["Icon"]
    icons = ROOT / "src-tauri/icons"
    installed_icons = appdir / "usr/share/icons/hicolor"
    for size in (32, 64, 128, 256, 512):
        dimension = f"{size}x{size}"
        approved = icons / ("icon.png" if size == 512 else f"{dimension}.png")
        installed_icon = installed_icons / dimension / "apps" / f"{name}.png"
        require(installed_icon.read_bytes() == approved.read_bytes(),
                f"{dimension} desktop icon differs from the approved artwork")
    require((appdir / ".DirIcon").read_bytes() == (icons / "icon.png").read_bytes(),
            "Unexpected AppDir icon")
    require((appdir / f"{name}.png").read_bytes() in
            [icon.read_bytes() for icon in icons.glob("*.png")], "Unexpected root desktop icon")
    (evidence / "appimage.desktop").write_bytes(desktop.read_bytes())


def main():
    image = Path(sys.argv[1]).resolve(strict=True)
    evidence = Path(sys.argv[2]).resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    version = json.loads((ROOT / "package.json").read_text())["version"]
    expected_name = f"ChatPlus-Desktop-{version}-x86_64.AppImage"
    with tempfile.TemporaryDirectory(prefix="chatplus-audit-") as temporary:
        run(image, "--appimage-extract", cwd=temporary)
        appdir = Path(temporary) / "squashfs-root"
        executable = appdir / "usr/bin/chatplus-desktop"
        for entry in (appdir / "AppRun", executable):
            require(os.access(entry, os.X_OK), f"Missing or non-executable: {entry.name}")
        inventory = {"<AppImage runtime>": elf_info(image)}
        for path in sorted(appdir.rglob("*")):
            if path.is_file() and not path.is_symlink():
                info = elf_info(path)
                if info is not None:
                    inventory[str(path.relative_to(appdir))] = info
        (evidence / "elf.json").write_text(json.dumps(inventory, indent=2) + "\n")
        main_elf = inventory["usr/bin/chatplus-desktop"]
        require(main_elf["interpreter"] == "/lib64/ld-linux-x86-64.so.2",
                f"Unexpected main executable interpreter: {main_elf['interpreter']}")
        require(main_elf["glibc"], "No GLIBC version requirements found for main executable")
        # The app's rewritten RUNPATH points into its AppDir. Do not add a
        # search path that would conceal a packaging failure from ldd.
        result = subprocess.run(["ldd", executable], capture_output=True, text=True,
                                env={"PATH": os.environ["PATH"], "LC_ALL": "C"})
        ldd = result.stdout + result.stderr
        (evidence / "ldd.txt").write_text(ldd)
        maximum = max(tuple(map(int, v.split("."))) for info in inventory.values()
                      for v in info["glibc"])
        incompatible = {name: info["glibc"][-1] for name, info in inventory.items()
                        if info["glibc"] and tuple(map(int, info["glibc"][-1].split("."))) > BASELINE}
        summary = {
            "artifact": image.name,
            "sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
            "elf_count": len(inventory),
            "executable_glibc": main_elf["glibc"][-1],
            "maximum_glibc": ".".join(map(str, maximum)),
            "over_baseline": incompatible,
        }
        (evidence / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps(summary, indent=2))
        require(not incompatible, "ELF GLIBC requirement exceeds Ubuntu 22.04 (2.35)")
        for name, info in inventory.items():
            require(not info["other_glibc_abi"],
                    f"{name} requires additional GLIBC ABI: {info['other_glibc_abi']}")
        require(image.name == expected_name, f"Expected public filename {expected_name}")
        require(not result.returncode and "not found" not in ldd, "Unresolved main executable dependencies")
        # libgcrypt requires this even when a desktop happens to have its own
        # copy. A minimal Debian 13 GUI does not supply it transitively.
        match = re.search(r"libgpg-error\.so\.0 => (.+?) \(0x", ldd)
        bundled_gpg = (appdir / "usr/lib/libgpg-error.so.0").resolve()
        require(match and bundled_gpg.is_relative_to(appdir) and Path(match[1]).resolve() == bundled_gpg,
                "libgpg-error.so.0 must resolve inside the AppImage")
        check_desktop(appdir, evidence)


if __name__ == "__main__":
    main()
