# -*- coding: utf-8 -*-
"""用用户提供的 icon.png 生成插件全套商店素材:
icons/icon16|48|128.png + store/logo_300.png + store/promo_small_440x280.png + store/promo_large_1400x560.png
"""
import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import Qt, QRect
from PySide6.QtGui import QPixmap, QImage, QPainter, QColor, QFont, QBrush
from PySide6.QtWidgets import QApplication

app = QApplication([])

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "icon.png")
ICONS_DIR = os.path.join(ROOT, "icons")
STORE_DIR = os.path.join(ROOT, "store")
os.makedirs(ICONS_DIR, exist_ok=True)
os.makedirs(STORE_DIR, exist_ok=True)

src_img = QImage(SRC)
print("source:", src_img.width(), "x", src_img.height())

# 采样图标边缘平均颜色, 决定宣传图背景深浅(图标深→浅底, 图标浅→深底)
def edge_brightness(img):
    w, h = img.width(), img.height()
    total = 0
    n = 0
    for x in range(w):
        for y in (0, h - 1):
            c = img.pixelColor(x, y)
            total += (c.red() + c.green() + c.blue()) / 3
            n += 1
    for y in range(h):
        for x in (0, w - 1):
            c = img.pixelColor(x, y)
            total += (c.red() + c.green() + c.blue()) / 3
            n += 1
    return total / n if n else 200

def scaled(src, size):
    return src.scaled(size, size, Qt.KeepAspectRatio, Qt.SmoothTransformation)

# 1. 扩展图标 16/48/128(平滑缩放)
for size in (16, 48, 128):
    out = scaled(src_img, size).save(os.path.join(ICONS_DIR, f"icon{size}.png"), "PNG")
    print(f"icons/icon{size}.png saved")

# 2. 商店徽标 300x300(商店要求: 1:1, 推荐 300x300, 最小 128x128)
logo = scaled(src_img, 300)
logo.save(os.path.join(STORE_DIR, "logo_300.png"), "PNG")
print("store/logo_300.png saved")

# 3. 宣传图(可选): 图标 + 应用名
bright = edge_brightness(src_img)
if bright > 140:  # 图标偏亮 → 深色底 + 浅色字
    bg, fg = QColor(23, 34, 46), QColor(234, 244, 251)
else:             # 图标偏暗 → 浅色底 + 深色字
    bg, fg = QColor(239, 246, 252), QColor(46, 94, 140)

APP_NAME = "Dadealbit 知乎提取器"
TAGLINE = "一键打包知乎文章/回答: Markdown · HTML · PDF · 图片 · 公式"

def make_tile(w, h, icon_size, path):
    pix = QPixmap(w, h)
    pix.fill(bg)
    p = QPainter(pix)
    p.setRenderHint(QPainter.Antialiasing)
    icon = scaled(src_img, icon_size)
    iy = (h - icon_size) // 2
    p.drawImage(QRect(48, iy, icon_size, icon_size), icon)
    tx = 48 + icon_size + 48
    p.setPen(fg)
    f1 = QFont("Microsoft YaHei")
    f1.setPixelSize(int(h * 0.16))
    f1.setBold(True)
    p.setFont(f1)
    p.drawText(QRect(tx, 0, w - tx - 48, h // 2), Qt.AlignLeft | Qt.AlignBottom, APP_NAME)
    f2 = QFont("Microsoft YaHei")
    f2.setPixelSize(int(h * 0.09))
    p.setFont(f2)
    p.setPen(QColor(fg.red(), fg.green(), fg.blue(), 200))
    p.drawText(QRect(tx, h // 2, w - tx - 48, h // 2), Qt.AlignLeft | Qt.AlignTop, TAGLINE)
    p.end()
    pix.save(path, "PNG")
    print(path, "saved")

make_tile(440, 280, 200, os.path.join(STORE_DIR, "promo_small_440x280.png"))
make_tile(1400, 560, 380, os.path.join(STORE_DIR, "promo_large_1400x560.png"))
print("done")
