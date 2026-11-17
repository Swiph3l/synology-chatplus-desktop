"""Export native desktop application icons using Python and Pillow 13 or newer."""

from io import BytesIO
from pathlib import Path
from struct import pack

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / "assets" / "branding"
ICONS = ROOT / "src-tauri" / "icons"
SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)


def centered_icon(flat, size, fraction):
    width = round(size * fraction)
    mark = ImageOps.contain(flat, (width, width), Image.Resampling.LANCZOS)
    square = Image.new("RGBA", (size, size))
    square.paste(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return square


def write_icns(frames, path):
    # PNG-backed macOS iconset slots, including separate standard and Retina slots.
    slots = {
        b"icp4": 16, b"ic11": 32, b"icp5": 32, b"ic12": 64,
        b"ic07": 128, b"ic13": 256, b"ic08": 256, b"ic14": 512,
        b"ic09": 512, b"ic10": 1024,
    }
    chunks = []
    for slot, size in slots.items():
        data = BytesIO()
        frames[size].save(data, "PNG", optimize=True)
        png = data.getvalue()
        chunks.append(pack(">4sI", slot, 8 + len(png)) + png)
    payload = b"".join(chunks)
    path.write_bytes(pack(">4sI", b"icns", 8 + len(payload)) + payload)


def main():
    with Image.open(BRANDING / "chat-plus-flat.png") as flat:
        frames = {
            size: centered_icon(flat, size, 1.0 if size == 16 else 0.92 if size <= 64 else 0.82)
            for size in SIZES
        }
        # The shell and favicon render at small CSS sizes, including HiDPI displays.
        centered_icon(flat, 128, 0.92).save(ROOT / "public" / "chatplus.png", optimize=True)
    for size, filename in [(32, "32x32"), (64, "64x64"), (128, "128x128"),
                           (256, "128x128@2x"), (512, "icon")]:
        frames[size].save(ICONS / f"{filename}.png", optimize=True)
    windows = [frames[size] for size in SIZES if size <= 256]
    windows[-1].save(ICONS / "icon.ico", sizes=[frame.size for frame in windows],
                     append_images=windows[:-1])
    write_icns(frames, ICONS / "icon.icns")


if __name__ == "__main__":
    main()