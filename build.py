# Copyright (c) 2020 Khaled Hosny
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import argparse
import copy
import re
import datetime

from fontTools.designspaceLib import DesignSpaceDocument
from fontTools.fontBuilder import FontBuilder
from fontTools.ttLib import TTFont, newTable, getTableModule
from fontTools.ttLib.tables._h_e_a_d import mac_epoch_diff
from fontTools.varLib import build as merge
from fontTools.misc.transform import Transform
from fontTools.pens.pointPen import PointToSegmentPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from glyphsLib import GSFont, GSGlyph, GSLayer, GSComponent, GSAnchor
from glyphsLib.glyphdata import get_glyph as getGlyphInfo
from cffsubr import subroutinize


DEFAULT_TRANSFORM = [1, 0, 0, 1, 0, 0]

# https://www.microsoft.com/typography/otspec/os2.htm#cpr
CODEPAGE_RANGES = {
    1252: 0,
    1250: 1,
    1251: 2,
    1253: 3,
    1254: 4,
    1255: 5,
    1256: 6,
    1257: 7,
    1258: 8,
    # 9-15: Reserved for Alternate ANSI
    874: 16,
    932: 17,
    936: 18,
    949: 19,
    950: 20,
    1361: 21,
    # 22-28: Reserved for Alternate ANSI and OEM
    # 29: Macintosh Character Set (US Roman)
    # 30: OEM Character Set
    # 31: Symbol Character Set
    # 32-47: Reserved for OEM
    869: 48,
    866: 49,
    865: 50,
    864: 51,
    863: 52,
    862: 53,
    861: 54,
    860: 55,
    857: 56,
    855: 57,
    852: 58,
    775: 59,
    737: 60,
    708: 61,
    850: 62,
    437: 63,
}


def draw(layer, instance, pen=None):
    font = layer.parent.parent
    width = layer.width
    if pen is None:
        pen = T2CharStringPen(width, None)
    pen = PointToSegmentPen(pen)

    for path in layer.paths:
        nodes = list(path.nodes)

        pen.beginPath()
        if nodes:
            if not path.closed:
                node = nodes.pop(0)
                assert node.type == "line", "Open path starts with off-curve points"
                pen.addPoint(tuple(node.position), segmentType="move")
            else:
                # In Glyphs.app, the starting node of a closed contour is always
                # stored at the end of the nodes list.
                nodes.insert(0, nodes.pop())
            for node in nodes:
                node_type = node.type
                if node_type not in ["line", "curve", "qcurve"]:
                    node_type = None
                pen.addPoint(
                    tuple(node.position), segmentType=node_type, smooth=node.smooth
                )
        pen.endPath()

    for component in layer.components:
        componentLayer = getLayer(component.component, instance)
        transform = component.transform.value
        componentPen = pen.pen
        if transform != DEFAULT_TRANSFORM:
            componentPen = TransformPen(pen.pen, transform)
            xx, xy, yx, yy = transform[:4]
            if xx * yy - xy * yx < 0:
                componentPen = ReverseContourPen(componentPen)
        draw(componentLayer, instance, componentPen)

    return pen.pen


def makeKerning(font, master, glyphOrder):
    fea = ""

    groups = {}
    for name in glyphOrder:
        glyph = font.glyphs[name]
        if not glyph.export:
            continue
        if glyph.leftKerningGroup:
            group = f"@MMK_R_{glyph.leftKerningGroup}"
            if group not in groups:
                groups[group] = []
            groups[group].append(name)
        if glyph.rightKerningGroup:
            group = f"@MMK_L_{glyph.rightKerningGroup}"
            if group not in groups:
                groups[group] = []
            groups[group].append(name)
    for group, glyphs in groups.items():
        fea += f"{group} = [{' '.join(glyphs)}];\n"

    kerning = font.kerningRTL[master.id]
    pairs = ""
    classes = ""
    enums = ""
    for left in kerning:
        if left in font.glyphs and not font.glyphs[left].export:
            continue
        for right in kerning[left]:
            if right in font.glyphs and not font.glyphs[right].export:
                continue
            value = kerning[left][right]
            kern = f"<{value} 0 {value} 0>"
            if left.startswith("@") and right.startswith("@"):
                if value:
                    classes += f"pos {left} {right} {kern};\n"
            elif left.startswith("@") or right.startswith("@"):
                enums += f"enum pos {left} {right} {kern};\n"
            else:
                pairs += f"pos {left} {right} {kern};\n"

    fea += f"""
lookupflag IgnoreMarks;
{pairs}
{enums}
{classes}
"""

    return fea


def getLayer(glyph, instance):
    for layer in glyph.layers:
        if layer.name == instance.name:
            return layer
    return glyph.layers[0]


def makeAutoFeatures(instance, glyphOrder):
    font = instance.parent

    markClass = ""
    mark = ""
    curs = "lookupflag IgnoreMarks RightToLeft;\n"
    liga = ""

    exit = {}
    entry = {}
    lig = {}

    for gname in glyphOrder:
        glyph = font.glyphs[gname]
        if not glyph.export:
            continue

        layer = getLayer(glyph, instance)
        for anchor in layer.anchors:
            name = anchor.name
            x = round(anchor.position.x)
            y = round(anchor.position.y)
            if name.startswith("_"):
                markClass += f"markClass {gname} <anchor {x} {y}> @mark_{name[1:]};\n"
            elif name.startswith("caret_"):
                pass
            elif "_" in name:
                name, index = name.split("_")
                if gname not in lig:
                    lig[gname] = {}
                if index not in lig[gname]:
                    lig[gname][index] = []
                lig[gname][index].append((name, (x, y)))
            elif name == "exit":
                exit[gname] = (x, y)
            elif name == "entry":
                entry[gname] = (x, y)
            else:
                mark += f"pos base {gname} <anchor {x} {y}> mark @mark_{name};\n"

    for name, components in lig.items():
        mark += f"pos ligature {name}"
        for component, anchors in components.items():
            if component != "1":
                mark += " ligComponent"
            for anchor, (x, y) in anchors:
                mark += f" <anchor {x} {y}> mark @mark_{anchor}"
        mark += ";\n"

    for name in glyphOrder:
        if name in exit or name in entry:
            pos1 = entry.get(name)
            pos2 = exit.get(name)
            anchor1 = pos1 and f"{pos1[0]} {pos1[1]}" or "NULL"
            anchor2 = pos2 and f"{pos2[0]} {pos2[1]}" or "NULL"
            curs += f"pos cursive {name} <anchor {anchor1}> <anchor {anchor2}>;\n"

    return curs, markClass + mark


def makeCvFeatures(font, glyphOrder):
    fea = ""
    features = {}
    for name in glyphOrder:
        glyph = font.glyphs[name]
        if name.count(".") >= 2:
            base, feature, index = name.rsplit(".", 2)
            try:
                feature = int(feature)
                index = int(index)
            except ValueError:
                continue
            tag = f"cv{feature:02d}"
            if tag not in features:
                features[tag] = {}
            if base not in features[tag]:
                features[tag][base] = []
                if feature == 1:
                    features[tag][base].append(base)
            features[tag][base].append(name)

    for feature, subs in features.items():
        fea += f"feature {feature} {{\n"
        for base, alts in subs.items():
            fea += f"sub {base} from [{' '.join(alts)}];\n"
        fea += f"}} {feature};\n"

    return fea


RE_DELIM = re.compile(r"(?:/(.*?.)/)")


def makeFeatures(instance, master, opts, glyphOrder):
    font = instance.parent

    def repl(match):
        regex = re.compile(match.group(1))
        return " ".join(n for n in glyphOrder if regex.match(n))

    for x in list(font.featurePrefixes) + list(font.classes) + list(font.features):
        x.code = RE_DELIM.sub(repl, x.code)

    fea = ""
    for gclass in font.classes:
        if gclass.disabled:
            continue
        if not gclass.code and gclass.name == "AllLetters":
            glyphs = [n for n in glyphOrder if getGlyphInfo(n).category == "Letter"]
            gclass.code = " ".join(glyphs)
        fea += f"@{gclass.name} = [{gclass.code}];\n"

    for prefix in font.featurePrefixes:
        if prefix.disabled:
            continue
        fea += prefix.code + "\n"

    curs, mark = makeAutoFeatures(instance, glyphOrder)
    kern = makeKerning(font, master, glyphOrder)
    cvxx = makeCvFeatures(font, glyphOrder)

    marker = "# Automatic Code"

    for feature in font.features:
        if feature.disabled:
            continue
        if feature.name == "mark":
            feature.code = feature.code.replace(marker, mark)
        if feature.name == "curs":
            feature.code = feature.code.replace(marker, curs)
        if feature.name == "kern":
            feature.code = feature.code.replace(marker, kern)
        if feature.name == "dist":
            fea += cvxx

        fea += f"""
            feature {feature.name} {{
            {feature.code}
            }} {feature.name};
        """

    marks = set()
    carets = ""
    for name in glyphOrder:
        glyph = font.glyphs[name]
        if not glyph.export:
            continue

        if glyph.category and glyph.subCategory:
            if glyph.category == "Mark" and glyph.subCategory == "Nonspacing":
                marks.add(name)
        else:
            layer = getLayer(glyph, instance)
            caret = ""
            for anchor in layer.anchors:
                if anchor.name.startswith("_"):
                    marks.add(name)
                elif anchor.name.startswith("caret_"):
                    _, index = anchor.name.split("_")
                    if not caret:
                        caret = f"LigatureCaretByPos {name}"
                    caret += f" {anchor.position.x}"
            if caret:
                carets += f"{caret};\n"

    fea += f"""
@MARK = [{" ".join(sorted(marks))}];
table GDEF {{
 GlyphClassDef , , @MARK, ;
{carets}
}} GDEF;
"""

    if opts.debug:
        with open(f"{instance.fontName}.fea", "w") as f:
            f.write(fea)
    return fea


def calcFsSelection(instance):
    font = instance.parent
    fsSelection = 0
    if font.customParameters["Use Typo Metrics"]:
        fsSelection |= 1 << 7
    if instance.isItalic:
        fsSelection |= 1 << 1
    if instance.isBold:
        fsSelection |= 1 << 5
    if not (instance.isItalic or instance.isBold):
        fsSelection |= 1 << 6

    return fsSelection


def calcBits(bits, start, end):
    b = 0
    for i in reversed(range(start, end)):
        b = b << 1
        if i in bits:
            b = b | 0x1
    return b


def get_property(font, key):
    for prop in font.properties:
        if key == prop.key:
            return prop.defaultValue
    return None


def build(instance, opts, glyphOrder):
    font = instance.parent
    master = font.masters[0]

    advanceWidths = {}
    characterMap = {}
    charStrings = {}
    colorLayers = {}
    for name in glyphOrder:
        glyph = font.glyphs[name]
        if not glyph.export:
            continue
        for layer in glyph.layers:
            if "colorPalette" in layer.attr:
                index = layer.attr["colorPalette"]
                if name not in colorLayers:
                    colorLayers[name] = []
                colorLayers[name].append((name, int(index)))

        if glyph.unicode:
            characterMap[int(glyph.unicode, 16)] = name

        layer = getLayer(glyph, instance)
        charStrings[name] = draw(layer, instance).getCharString()
        advanceWidths[name] = layer.width

    # XXX
    glyphOrder.pop(glyphOrder.index(".notdef"))
    glyphOrder.pop(glyphOrder.index("space"))
    glyphOrder.insert(0, ".notdef")
    glyphOrder.insert(1, "space")

    version = float(opts.version)

    vendor = get_property(font, "vendorID")
    names = {
        "copyright": font.copyright,
        "familyName": instance.familyName,
        "styleName": instance.name,
        "uniqueFontIdentifier": f"{version:.03f};{vendor};{instance.fontName}",
        "fullName": instance.fullName,
        "version": f"Version {version:.03f}",
        "psName": instance.fontName,
        "manufacturer": font.manufacturer,
        "designer": font.designer,
        "vendorURL": font.manufacturerURL,
        "designerURL": font.designerURL,
        "licenseDescription": get_property(font, "licenses"),
        "licenseInfoURL": get_property(font, "licenseURL"),
        "sampleText": get_property(font, "sampleTexts"),
    }

    fb = FontBuilder(font.upm, isTTF=False)
    date = font.date.replace(tzinfo=datetime.timezone.utc)
    stat = opts.glyphs.stat()
    fb.updateHead(
        fontRevision=version,
        created=int(date.timestamp()) - mac_epoch_diff,
        modified=int(stat.st_mtime) - mac_epoch_diff,
    )
    fb.setupGlyphOrder(glyphOrder)
    fb.setupCharacterMap(characterMap)
    fb.setupNameTable(names, mac=False)
    fb.setupHorizontalHeader(
        ascent=master.ascender,
        descent=master.descender,
        lineGap=master.customParameters["hheaLineGap"],
    )

    if opts.debug:
        fb.setupCFF(names["psName"], {}, charStrings, {})
        fb.font["CFF "].compile(fb.font)
    else:
        fb.setupCFF2(charStrings)

    metrics = {}
    for name, width in advanceWidths.items():
        bounds = charStrings[name].calcBounds(None) or [0]
        metrics[name] = (width, bounds[0])
    fb.setupHorizontalMetrics(metrics)

    fb.setupPost(
        underlinePosition=master.customParameters["underlinePosition"],
        underlineThickness=master.customParameters["underlineThickness"],
    )

    # Compile to get font bbox
    fb.font["head"].compile(fb.font)

    codePages = [CODEPAGE_RANGES[v] for v in font.customParameters["codePageRanges"]]
    fb.setupOS2(
        version=4,
        sTypoAscender=master.ascender,
        sTypoDescender=master.descender,
        sTypoLineGap=master.customParameters["typoLineGap"],
        usWinAscent=fb.font["head"].yMax,
        usWinDescent=-fb.font["head"].yMin,
        sxHeight=master.xHeight,
        sCapHeight=master.capHeight,
        achVendID=vendor,
        fsType=calcBits(font.customParameters["fsType"], 0, 16),
        fsSelection=calcFsSelection(instance),
        ulUnicodeRange1=calcBits(font.customParameters["unicodeRanges"], 0, 32),
        ulCodePageRange1=calcBits(codePages, 0, 32),
    )

    fea = makeFeatures(instance, master, opts, glyphOrder)
    fb.addOpenTypeFeatures(fea)

    palettes = master.customParameters["Color Palettes"]
    palettes = [[tuple(v / 255 for v in c) for c in p] for p in palettes]
    fb.setupCPAL(palettes)
    fb.setupCOLR(colorLayers)

    instance.font = fb.font
    if opts.debug:
        fb.font.save(f"{instance.fontName}.otf")

    return fb.font


def buildVF(opts):
    font = GSFont(opts.glyphs)
    glyphOrder = buildAltGlyphs(font)
    prepare(font)

    for instance in font.instances:
        print(f" MASTER  {instance.name}")
        build(instance, opts, glyphOrder)
        if instance.name == "Regular":
            regular = instance

    ds = DesignSpaceDocument()

    for i, axisDef in enumerate(font.axes):
        axis = ds.newAxisDescriptor()
        axis.tag = axisDef.axisTag
        axis.name = axisDef.name
        axis.maximum = max(x.axes[i] for x in font.instances)
        axis.minimum = min(x.axes[i] for x in font.instances)
        axis.default = regular.axes[i]
        ds.addAxis(axis)

    for instance in font.instances:
        source = ds.newSourceDescriptor()
        source.font = instance.font
        source.familyName = instance.familyName
        source.styleName = instance.name
        source.name = instance.fullName
        source.location = {a.name: instance.axes[i] for i, a in enumerate(ds.axes)}
        ds.addSource(source)

    print(f" MERGE   {font.familyName}")
    otf, _, _ = merge(ds)
    subroutinize(otf)
    if not opts.debug:
        otf["post"].formatType = 3.0
    return otf


def propagateAnchors(layer):
    for component in layer.components:
        clayer = component.layer or component.component.layers[0]
        propagateAnchors(clayer)
        for anchor in clayer.anchors:
            names = [a.name for a in layer.anchors]
            name = anchor.name
            if name.startswith("_") or name in names:
                continue
            if name in ("entry", "exit"):
                continue
            x, y = anchor.position.x, anchor.position.y
            if component.transform != DEFAULT_TRANSFORM:
                t = Transform(*component.transform.value)
                x, y = t.transformPoint((x, y))
            new = GSAnchor(name)
            new.position.x, new.position.y = (x, y)
            layer.anchors[name] = new


def prepare(font):
    for glyph in font.glyphs:
        if not glyph.export:
            continue
        for layer in glyph.layers:
            propagateAnchors(layer)


def buildAltGlyph(glyph, alternates, componentName):
    glyphs = []
    for alternate in alternates:
        newGlyph = GSGlyph()
        name = glyph.name
        if name.endswith(".00"):
            newGlyph.name = name.rsplit(".", 1)[0]
        else:
            newGlyph.name = f"{name}.01"
        for attr in {
            "category",
            "subCategory",
            "script",
            "leftKerningGroup",
            "rightKerningGroup",
        }:
            setattr(newGlyph, attr, getattr(glyph, attr))

        for layer in glyph.layers:
            newLayer = GSLayer()
            for attr in {"name", "width", "associatedMasterId"}:
                setattr(newLayer, attr, getattr(layer, attr))
            newLayer.anchors.setter([copy.copy(a) for a in layer.anchors])
            newLayer.components.setter([copy.copy(c) for c in layer.components])
            for component in newLayer.components:
                if component.componentName == componentName:
                    component.componentName = alternate
            newLayer.paths.setter([copy.copy(p) for p in layer.paths])
            newGlyph.layers.append(newLayer)
        glyphs.append(newGlyph)
    return glyphs


def updateKerning(font, glyph, alternates):
    for layer in glyph.layers:
        kerning = font.kerningRTL[layer.associatedMasterId]
        for component in layer.components:
            if component.componentName in alternates:
                for left in list(kerning):
                    if left == component.componentName:
                        assert False  # XXX
                    for right in list(kerning[left]):
                        if right == component.componentName:
                            kerning[left][glyph.name] = kerning[left][right]


def buildAltGlyphs(font):
    glyphOrder = [g.name for g in font.glyphs]
    newOrder = []
    alts = {}
    for name in glyphOrder:
        if name.startswith("-") and not "." in name:
            alts[name] = [n for n in glyphOrder if n.startswith(name + ".")]

    for name in glyphOrder:
        glyph = font.glyphs[name]
        if not glyph.export:
            continue
        newOrder.append(name)
        counter = 1
        for component in glyph.layers[0].components:
            if component.componentName in alts:
                alternates = alts[component.componentName]
                glyphs = buildAltGlyph(glyph, alternates, component.componentName)
                for newGlyph in glyphs:
                    newGlyph.name += f".{counter:02}"
                    counter += 1
                    font.glyphs.append(newGlyph)
                    updateKerning(font, newGlyph, alternates)
                    newOrder.append(newGlyph.name)
    return newOrder


def main():
    from pathlib import Path

    parser = argparse.ArgumentParser(description="Build Rana Kufi.")
    parser.add_argument("glyphs", help="input Glyphs source file", type=Path)
    parser.add_argument("version", help="font version")
    parser.add_argument("otf", help="output OTF file", type=Path)
    parser.add_argument("--debug", help="Save debug files", action="store_true")
    args = parser.parse_args()

    otf = buildVF(args)
    otf.save(args.otf)


main()
