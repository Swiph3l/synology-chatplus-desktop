"""Drive the normal packaged UI with X11. Called by smoke-appimage.sh."""

from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import signal
import struct
import subprocess
import sys
import time


IMAGE = Path(sys.argv[1])
EVIDENCE = Path(sys.argv[2])
DATA = Path(os.environ["XDG_DATA_HOME"]) / "io.github.swiph3l.chatplus-desktop"
STORE = DATA / "settings.json"


def output(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()


@contextmanager
def launch(scenario):
    log = EVIDENCE / f"{scenario}.log"
    with log.open("w") as stream:
        process = subprocess.Popen([IMAGE], stdout=stream, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            yield process
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
    pattern = (
        r"(?im)^.*(?:GLIBC[\w.]*.{0,20}not found|symbol lookup error|error while loading "
        r"shared libraries|panicked at|segmentation fault|failed to initialize|[\w-]+-CRITICAL\b).*$"
    )
    failures = re.findall(pattern, log.read_text(errors="replace"))
    if failures:
        raise RuntimeError("\n".join(failures))


def check_alive(process):
    if process.poll() is not None:
        raise RuntimeError(f"AppImage exited prematurely with status {process.returncode}")


def windows():
    result = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", r"Chat\+ Desktop"],
                            capture_output=True, text=True)
    return result.stdout.splitlines()


def observe(process, label, expected, exclude=None):
    deadline = time.monotonic() + 50
    screenshot = EVIDENCE / f"{label}.png"
    transcript = EVIDENCE / f"{label}.txt"
    while time.monotonic() < deadline:
        check_alive(process)
        for window in windows():
            if window == exclude:
                continue
            subprocess.run(["import", "-silent", "-window", window, screenshot],
                           check=True, timeout=8)
            content = output("tesseract", screenshot, "stdout", "-l", "eng", "--psm", "11")
            transcript.write_text(content + "\n")
            if re.search(expected, " ".join(content.split()), re.I):
                return window
        time.sleep(0.6)
    raise RuntimeError(f"{label}: expected rendered text matching {expected!r}, see {transcript}")


def verify_window(window, scenario):
    pid = output("xdotool", "getwindowpid", window)
    executable = Path(f"/proc/{pid}/exe").resolve(strict=True)
    if executable.name != "chatplus-desktop":
        raise RuntimeError(f"Window belongs to {executable}")
    # Request numeric CARDINALs so we can compare the actual X11 artwork.
    prop = output("xprop", "-id", window, "-notype", "-f", "_NET_WM_ICON", "32c", "_NET_WM_ICON")
    values = [int(value) for value in re.findall(r"\d+", prop.partition("=")[2])]
    if values[:2] != [32, 32] or len(values) < 2 + 32 * 32:
        raise RuntimeError("Mapped application window lacks its expected 32x32 icon")
    png = executable.parents[1] / "share/icons/hicolor/32x32/apps/chatplus-desktop.png"
    raw = subprocess.check_output(["convert", png, "-depth", "8", "rgba:-"])
    expected = [(a << 24) | (r << 16) | (g << 8) | b
                for r, g, b, a in struct.iter_unpack("BBBB", raw)]
    icon = values[2:2 + len(expected)]
    # RGB in transparent or translucent pixels may be premultiplied by GTK.
    if any(actual >> 24 != approved >> 24 or (approved >> 24 == 255 and actual != approved)
           for actual, approved in zip(icon, expected)):
        raise RuntimeError("Visible window icon differs from the packaged Chat+ artwork")
    wm_class = output("xprop", "-id", window, "-notype", "WM_CLASS")
    (EVIDENCE / f"{scenario}-window.txt").write_text(
        f"{executable}\n{wm_class}\n_NET_WM_ICON: matched packaged 32x32 PNG\n")
    # The live loader map distinguishes bundled libraries from the host even
    # when AppRun sets search paths that are invisible to a standalone ldd.
    (EVIDENCE / f"{scenario}-maps.txt").write_bytes(Path(f"/proc/{pid}/maps").read_bytes())
    return pid


def run():
    with launch("fresh") as process:
        window = observe(process, "onboarding", r"Choose the service you want to add first")
        verify_window(window, "onboarding")
    # Seed an ordinary persisted profile, without a network dependency or
    # production credentials. Preserve all unrelated first-run store keys.
    DATA.mkdir(parents=True, exist_ok=True)
    values = json.loads(STORE.read_text()) if STORE.exists() else {}
    service = {"id": "smoke", "provider": "synology-chatplus", "name": "Offline fixture",
               "url": "https://offline.invalid/chat/", "enabled": True, "notifications": False}
    values["settings"] = {"onboardingCompleted": True, "activeService": "smoke", "serviceSchema": 1,
                          "services": [service], "automaticUpdates": True, "language": "en"}
    STORE.write_text(json.dumps(values))
    profile = DATA / "services/smoke"
    profile.mkdir(parents=True, exist_ok=True)
    marker = profile / "session-preservation.txt"
    marker.write_text("synthetic profile data")
    with launch("configured") as process:
        main = observe(process, "offline-workspace",
                       r"network unavailable|offline /|(?:could not|cannot|can.t|unable to|failed to) "
                       r"(?:connect|resolve|reach)|error resolving|server not found")
        pid = verify_window(main, "workspace")
        subprocess.run(["xdotool", "windowfocus", "--sync", main, "key", "--clearmodifiers",
                        "ctrl+comma"], check=True, timeout=6)
        observe(process, "settings", r"Appearance|Minimize to tray", exclude=main)
        # AppImageHub observes for eleven seconds. Catch delayed termination,
        # disappearing windows and repeated WebKit crashes on the same screen.
        web_processes = set()
        for _ in range(12):
            check_alive(process)
            if main not in windows() or output("xdotool", "getwindowpid", main) != pid:
                raise RuntimeError("Original workspace disappeared or restarted")
            for child in Path("/proc").glob("[0-9]*/stat"):
                try:
                    stat = child.read_text()
                except (FileNotFoundError, PermissionError, ProcessLookupError):
                    continue
                fields = stat[stat.rfind(")") + 2:].split()
                if fields[3] == str(process.pid) and "(WebKitWebProces" in stat:
                    web_processes.add(child.parent.name)
            time.sleep(1)
        (EVIDENCE / "renderer-pids.txt").write_text("\n".join(sorted(web_processes)) + "\n")
        if not web_processes:
            raise RuntimeError("No live WebKit renderer observed during the stability check")
        if len(web_processes) > 5:
            raise RuntimeError(f"Unexpected WebKit renderer churn: {sorted(web_processes)}")
    saved = json.loads(STORE.read_text())["settings"]
    if not any(s["id"] == service["id"] and s["url"] == service["url"] for s in saved["services"]):
        raise RuntimeError("Offline startup lost the configured account")
    if marker.read_text() != "synthetic profile data":
        raise RuntimeError("Offline startup cleared the service profile")
    print("Observed rendered onboarding, offline workspace and Settings with the original process.")


if __name__ == "__main__":
    run()
