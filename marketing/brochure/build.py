"""Build the six-page Italian and English customer brochures from editable copy.

Requires reportlab and Pillow. Run from any directory: python marketing/brochure/build.py
No network access, no customer data and no fabricated product screenshots: each edition shows
the product in its own language, filmed by capture.mjs into assets/<lang>/.
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
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
ASSETS = ROOT / "assets"
CONTACT = json.loads((ROOT.parent / "contact.json").read_text(encoding="utf-8"))
W, H = A4
M = 43
CW = W - M * 2
NAVY, INK, BLUE = "#0E1530", "#101A33", "#3B67FF"
SKY, MUTED, PAPER = "#8FB0FF", "#5B6780", "#F2F5FB"
WHITE = "#FFFFFF"

# The part of each capture worth showing, as fractions (left, top, right, bottom) of the frame.
# What is left is cut further, from the sides or the bottom, so that it fills its frame.
CROPS = {
    "dashboard": (0.15, 0.08, 1, 0.83),
    "builder": (0.16, 0.03, 1, 0.81),
    "api": (0.15, 0.03, 0.75, 0.60),
    "failure": (0.15, 0.37, 1, 0.86),
    "mobile": (0, 0.07, 0.83, 0.70),
    "bdd": (0, 0, 1, 0.62),
}


def fonts():
    """Inter, under the SIL Open Font License, ships in fonts/: the build is the same on any OS."""
    directory = Path(os.environ.get("WFM_BROCHURE_FONT_DIR", ROOT / "fonts"))
    for name, file in [("Body", "Inter-Regular.ttf"), ("Bold", "Inter-Bold.ttf")]:
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


def shot(c, name, lang, top, height, x=M, width=CW):
    """A screenshot of the product in the edition's language, cut to fill its frame."""
    frame_w, frame_h = width - 12, height - 12
    with Image.open(ASSETS / lang / f"{name}.jpg") as source:
        left, upper, right, lower = CROPS[name]
        img = source.crop((round(source.width * left), round(source.height * upper),
                           round(source.width * right), round(source.height * lower)))
    # Keep the top of the screen; trim the sides evenly, or the bottom.
    if img.width / img.height > frame_w / frame_h:
        keep = round(img.height * frame_w / frame_h)
        img = img.crop(((img.width - keep) // 2, 0, (img.width + keep) // 2, img.height))
    else:
        img = img.crop((0, 0, img.width, round(img.width * frame_h / frame_w)))
    rect(c, x, top, width, height, "#E2E8F5", 10)
    c.drawImage(ImageReader(img.convert("RGB")), x + 6, H - top - 6 - frame_h,
                width=frame_w, height=frame_h)


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


def tiles(c, items, lang, top, height, shot_h):
    """Two by two: a screenshot above each heading and its text."""
    gap = 16
    width = (CW - gap) / 2
    for i, (name, heading, body) in enumerate(items):
        x = M + (i % 2) * (width + gap)
        y = top + (i // 2) * (height + gap)
        shot(c, name, lang, y, shot_h, x, width)
        end = para(c, heading, x + 2, y + shot_h + 11, width - 4, 13, INK, True)
        bottom = para(c, body, x + 2, end + 4, width - 4, 9.6, MUTED)
        if bottom > y + height:
            raise ValueError(f"Tile overflow: {heading}")
    return top + 2 * height + gap


def build(lang, t):
    for name in CROPS:
        if not (ASSETS / lang / f"{name}.jpg").exists():
            raise FileNotFoundError(f"Missing assets/{lang}/{name}.jpg: run capture.mjs")
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
    shot(c, "dashboard", lang, 398, 286)
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

    # 3: Four complementary testing modes, each with its own screen.
    page(c, 3, lang)
    end = title(c, t["p3_label"], t["p3_title"])
    end = tiles(c, [(name, heading, body) for name, (heading, body)
                    in zip(["builder", "api", "mobile", "bdd"], t["test_cards"])],
                lang, end + 22, 250, 148)
    para(c, t["p3_note"], M, end + 12, CW, 9, MUTED)
    c.showPage()

    # 4: From a run to the evidence of its failure.
    page(c, 4, lang)
    end = title(c, t["p4_label"], t["p4_title"])
    end = para(c, t["p4_intro"], M, end + 17, CW, 12, MUTED)
    for i, (heading, body) in enumerate(t["result_cards"]):
        top = end + 24
        para(c, f"0{i + 1}", M, top, 30, 16, BLUE, True)
        bottom = para(c, heading, M + 45, top, CW - 45, 14, INK, True)
        end = para(c, body, M + 45, bottom + 7, CW - 45, 11, MUTED)
    shot(c, "failure", lang, end + 24, 191)
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

    # 6: Pilot invitation, licence, conditions and screenshot provenance.
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
    end = para(c, t["licence"], M, end + 6, CW, 11, WHITE, True)
    end = para(c, CONTACT["name"], M, end + 16, CW, 12, WHITE, True)
    contact_top = end + 7
    items = [(value, url) for value, url in [
        (CONTACT["email"], "mailto:" + CONTACT["email"]),
        (CONTACT["website"], "https://" + CONTACT["website"]),
        (CONTACT["phone"], "tel:" + CONTACT["phone"].replace(" ", "")),
    ] if value]
    separator = "  /  "
    end = para(c, separator.join(value for value, _ in items), M, contact_top, CW, 10.2, SKY)
    # One link area per item, as wide as its text: the contact values are not fixed any more.
    x = M
    for value, url in items:
        width = pdfmetrics.stringWidth(value, "Body", 10.2)
        c.linkURL(url, (x, H-end, x + width, H-contact_top), relative=0)
        x += width + pdfmetrics.stringWidth(separator, "Body", 10.2)
    para(c, "\n".join([t["footer_note"], t["capture_note"], t["distribution_note"]]),
         M, end + 20, CW, 8, "#A2B1CE")
    c.showPage()
    c.save()
    print(f"Built {destination} (6 pages)")


if __name__ == "__main__":
    fonts()
    OUT.mkdir(parents=True, exist_ok=True)
    for lang, content in json.loads((ROOT / "copy.json").read_text(encoding="utf-8")).items():
        build(lang, content)
