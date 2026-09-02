# -*- coding: utf-8 -*-
"""生成插件图标: 蓝色圆角方块 + 白色「知」字 (16/48/128)"""
import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap, QPainter, QColor, QFont, QBrush, QPainterPath
from PySide6.QtWidgets import QApplication

app = QApplication([])

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(out_dir, exist_ok=True)

for size in (16, 48, 128):
    pix = QPixmap(size, size)
    pix.fill(Qt.transparent)
    p = QPainter(pix)
    p.setRenderHint(QPainter.Antialiasing)

    # 圆角背景: 蓝色渐变
    path = QPainterPath()
    radius = size * 0.22
    path.addRoundedRect(0, 0, size, size, radius, radius)
    p.setPen(Qt.NoPen)
    p.setBrush(QColor(63, 110, 156))
    p.drawPath(path)

    # 白色「知」字
    font = QFont("Microsoft YaHei")
    font.setPixelSize(int(size * 0.62))
    font.setBold(True)
    p.setFont(font)
    p.setPen(QColor(255, 255, 255))
    p.drawText(pix.rect(), Qt.AlignCenter, "知")

    p.end()
    pix.save(os.path.join(out_dir, f"icon{size}.png"), "PNG")
    print(f"icon{size}.png saved")

print("icons done")
