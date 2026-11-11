"""生成应用图标和托盘图标（需要 Pillow：pip install pillow）。

用法：python scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

BODY = (217, 119, 87, 255)   # #D97757
EYE = (20, 20, 19, 255)
BG = (38, 38, 36, 255)       # #262624

# 16 x 10 的 Clawd 像素图（# = 身体, o = 眼睛）
CLAWD = [
    "..############..",
    "..############..",
    "..##o######o##..",
    "..##o######o##..",
    "################",
    "################",
    "..############..",
    "..############..",
    "...#.#....#.#...",
    "...#.#....#.#...",
]

ASSETS = Path(__file__).resolve().parent.parent / "assets"


def draw_clawd(img, ox, oy, px):
    d = ImageDraw.Draw(img)
    for y, row in enumerate(CLAWD):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            color = EYE if ch == "o" else BODY
            d.rectangle([ox + x * px, oy + y * px, ox + (x + 1) * px - 1, oy + (y + 1) * px - 1], fill=color)


def tray(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = size // 16
    draw_clawd(img, 0, (size - 10 * px) // 2, px)
    return img


def app_icon(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    margin = size // 16
    d.rounded_rectangle([margin, margin, size - margin, size - margin], radius=size // 5, fill=BG)
    px = size // 22
    w, h = 16 * px, 10 * px
    draw_clawd(img, (size - w) // 2, (size - h) // 2 + px // 2, px)
    return img


if __name__ == "__main__":
    ASSETS.mkdir(exist_ok=True)
    tray(16).save(ASSETS / "tray.png")
    tray(32).save(ASSETS / "tray@2x.png")
    app_icon(1024).resize((512, 512), Image.NEAREST).save(ASSETS / "icon.png")
    print("icons written to", ASSETS)
