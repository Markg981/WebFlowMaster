"""Build the six-page Italian and English customer brochures from editable copy.

Requires reportlab and Pillow. Run from any directory: python marketing/brochure/build.py
No network access, no customer data and no fabricated product screenshots.
"""
from pathlib import Path
import json
import os
from xml.sax.saxutils import escape
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
ASSETS = ROOT / "assets"
W, H = A4
M = 43
CW = W - M * 2
NAVY, INK, BLUE = "#0E1530", "#101A33", "#3B67FF"
SKY, MUTED, PAPER = "#8FB0FF", "#5B6780", "#F2F5FB"
WHITE = "#FFFFFF"


def fonts():
    """Use embedded Segoe UI, or the caller's font directory on other systems."""
    directory = Path(os.environ.get("WFM_BROCHURE_FONT_DIR", "C:/Windows/Fonts"))
    for name, file in [("Body", "segoeui.ttf"), ("Bold", "segoeuib.ttf")]:
        candidate = directory / file
        if not candidate.exists():
            raise FileNotFoundError(f"Set WFM_BROCHURE_FONT_DIR: missing {candidate}")
        pdfmetrics.registerFont(TTFont(name, str(candidate)))
    pdfmetrics.registerFontFamily("Body", normal="Body", bold="Bold")


def para(c, text, x, top, width, size=11, color=INK, bold=False, leading=None):
    style = ParagraphStyle("text", fontName="Bold" if bold else "Body", fontSize=size,
                           leading=leading or size * 1.45, textColor=HexColor(color))
    p = Paragraph(escape(text).replace("\n", "<br/>"), style)
    _, height = p.wrap(width, H)
    if top + height > H - 44:
        raise ValueError(f"Content exceeds page: {text[:55]}")
    p.drawOn(c, x, H - top - height)
    return top + height


def rect(c, x, top, w, h, color, radius=0):
    c.setFillColor(HexColor(color))
    if radius:
        c.roundRect(x, H - top - h, w, h, radius, stroke=0, fill=1)
    else:
        c.rect(x, H - top - h, w, h, stroke=0, fill=1)


def mark(c, x, top, size=28):
    rect(c, x, top, size, size, BLUE, 7)
    c.setStrokeColor(HexColor(WHITE))
    c.setLineWidth(1.7)
    p = c.beginPath()
    p.moveTo(x + size * .23, H - top - size * .7)
    p.lineTo(x + size * .47, H - top - size * .38)
    p.lineTo(x + size * .72, H - top - size * .38)
    p.lineTo(x + size * .66, H - top - size * .64)
    c.drawPath(p)


def page(c, number, lang, dark=False):
    rect(c, 0, 0, W, H, NAVY if dark else WHITE)
    mark(c, M, 32, 25)
    para(c, "WebFlowMaster", M + 34, 34, 220, 13, WHITE if dark else INK, True)
    c.setStrokeColor(HexColor("#27324D" if dark else "#DAE1EF"))
    c.line(M, 51, W - M, 51)
    c.setFont("Body", 8)
    c.setFillColor(HexColor(SKY if dark else MUTED))
    c.drawString(M, 31, "WEBFLOWMASTER / " + lang.upper())
    c.drawRightString(W - M, 31, f"{number:02d} / 06")


def title(c, label, heading, dark=False):
    para(c, label, M, 88, CW, 9, SKY if dark else BLUE, True)
    return para(c, heading, M, 115, CW, 32, WHITE if dark else INK, True, 38)


def shot(c, name, top, height):
    source = ASSETS / name
    with Image.open(source) as img:
        ratio = img.width / img.height
    image_w = CW - 12
    image_h = image_w / ratio
    if image_h > height - 12:
        image_h = height - 12
        image_w = image_h * ratio
    rect(c, M, top, CW, height, "#E2E8F5", 10)
    c.drawImage(str(source), M + (CW - image_w) / 2, H - top - (height + image_h) / 2,
                width=image_w, height=image_h, mask="auto")


def cards(c, pairs, top, height=154, dark=False):
    gap = 16
    width = (CW - gap) / 2
    for i, (heading, body) in enumerate(pairs):
        x = M + (i % 2) * (width + gap)
        y = top + (i // 2) * (height + gap)
        rect(c, x, y, width, height, "#17213D" if dark else PAPER, 10)
        rect(c, x + 16, y + 19, 22, 3, SKY if dark else BLUE, 1)
        end = para(c, heading, x + 16, y + 32, width - 32, 13,
                   WHITE if dark else INK, True)
        bottom = para(c, body, x + 16, end + 8, width - 32, 10.2,
                      "#C2CDDF" if dark else MUTED)
        if bottom > y + height - 12:
            raise ValueError(f"Card overflow: {heading}")
    return top + ((len(pairs) + 1) // 2) * (height + gap) - gap


def build(lang, t):
    destination = OUT / f"webflowmaster-brochure-{lang}.pdf"
    c = canvas.Canvas(str(destination), pagesize=A4, pageCompression=1)
    c.setTitle(f"WebFlowMaster - {'Presentazione del prodotto' if lang == 'it' else 'Product presentation'}")
    c.setAuthor("WebFlowMaster / Marco Oliva")
    c.setSubject("Web, API, mobile and BDD testing platform")

    # 1: Product, promise, real interface.
    page(c, 1, lang, True)
    rect(c, W - 24, 94, 24, 245, BLUE)
    para(c, t["edition"], M, 91, CW, 9, SKY, True)
    end = para(c, t["cover_title"], M, 128, CW - 12, 39, WHITE, True, 46)
    end = para(c, t["cover_intro"], M, end + 22, CW - 15, 14, "#C2CDDF")
    para(c, t["cover_tags"], M, end + 22, CW, 11, SKY, True)
    shot(c, "dashboard.png", 398, 286)
    para(c, t["demo_caption"], M, 696, CW, 8, "#B0BED5")
    para(c, t["cover_line"], M, 751, CW, 16, WHITE, True)
    c.showPage()

    # 2: Buyer roles and tangible working cycle.
    page(c, 2, lang)
    end = title(c, t["p2_label"], t["p2_title"])
    end = para(c, t["p2_intro"], M, end + 16, CW, 12, MUTED)
    end = cards(c, t["value_cards"], end + 24, 156)
    end = para(c, t["workflow_title"], M, end + 26, CW, 15, INK, True)
    width = (CW - 24) / 5
    for i, word in enumerate(t["workflow"]):
        x = M + i * (width + 6)
        rect(c, x, end + 14, width, 36, BLUE, 6)
        para(c, word, x + 8, end + 23, width - 16, 10, WHITE, True)
    para(c, t["workflow_note"], M, end + 63, CW, 9, MUTED)
    c.showPage()

    # 3: Four complementary testing modes.
    page(c, 3, lang)
    end = title(c, t["p3_label"], t["p3_title"])
    end = cards(c, t["test_cards"], end + 23, 142)
    shot(c, "api.png", end + 20, 202)
    para(c, t["p3_note"], M, end + 234, CW, 9, MUTED)
    c.showPage()

    # 4: Explain the result without using stale report captures.
    page(c, 4, lang)
    end = title(c, t["p4_label"], t["p4_title"])
    end = para(c, t["p4_intro"], M, end + 17, CW, 12, MUTED)
    for i, (heading, body) in enumerate(t["result_cards"]):
        top = end + 24
        para(c, f"0{i + 1}", M, top, 30, 16, BLUE, True)
        bottom = para(c, heading, M + 45, top, CW - 45, 14, INK, True)
        end = para(c, body, M + 45, bottom + 7, CW - 45, 11, MUTED)
    shot(c, "dashboard.png", end + 24, 191)
    para(c, t["p4_note"], M, end + 229, CW, 9, MUTED)
    c.showPage()

    # 5: Integrations and deployment boundary.
    page(c, 5, lang)
    end = title(c, t["p5_label"], t["p5_title"])
    end = cards(c, t["integrations"], end + 24, 139)
    rect(c, M, end + 26, CW, 149, NAVY, 10)
    bottom = para(c, t["deployment_title"], M + 20, end + 45, CW - 40, 15, WHITE, True)
    para(c, t["deployment_body"], M + 20, bottom + 10, CW - 40, 11, "#C2CDDF")
    para(c, t["p5_note"], M, end + 192, CW, 9, MUTED)
    c.showPage()

    # 6: Pilot invitation, conditions and screenshot provenance.
    page(c, 6, lang, True)
    end = title(c, t["p6_label"], t["p6_title"], True)
    end = para(c, t["p6_intro"], M, end + 17, CW, 12, "#C2CDDF")
    for number, heading, body in t["pilot"]:
        top = end + 20
        para(c, number, M, top, 35, 19, SKY, True)
        bottom = para(c, heading, M + 49, top, CW - 49, 14, WHITE, True)
        end = para(c, body, M + 49, bottom + 4, CW - 49, 10.5, "#C2CDDF")
    rect(c, M, end + 24, CW, 49, BLUE, 8)
    para(c, t["cta"], M + 19, end + 36, CW - 38, 17, WHITE, True)
    end = para(c, t["cta_note"], M, end + 88, CW, 11, "#C2CDDF")
    end = para(c, "Marco Oliva", M, end + 18, CW, 12, WHITE, True)
    contact_top = end + 7
    end = para(c, "marco.oliva@aveva.com  /  www.aveva.com  /  +39 3473495072", M, contact_top, CW, 10.2, SKY)
    c.linkURL("mailto:marco.oliva@aveva.com", (M, H-end, M+150, H-contact_top), relative=0)
    c.linkURL("https://www.aveva.com", (M+155, H-end, M+262, H-contact_top), relative=0)
    c.linkURL("tel:+393473495072", (M+268, H-end, W-M, H-contact_top), relative=0)
    para(c, t["footer_note"] + "\n" + t["capture_note"], M, end + 24, CW, 8, "#A2B1CE")
    c.showPage()
    c.save()
    print(f"Built {destination} (6 pages)")


if __name__ == "__main__":
    fonts()
    OUT.mkdir(parents=True, exist_ok=True)
    for lang, content in json.loads((ROOT / "copy.json").read_text(encoding="utf-8")).items():
        build(lang, content)
