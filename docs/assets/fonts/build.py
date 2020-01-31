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

import sys

from fontTools.designspaceLib import DesignSpaceDocument
from fontTools.fontBuilder import FontBuilder
from fontTools.ttLib import TTFont, newTable, getTableModule
from fontTools.varLib import build as merge
from fontTools.misc.transform import Transform
from fontTools.pens.pointPen import PointToSegmentPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from glyphsLib import GSFont, GSAnchor


DEFAULT_TRANSFORM = [1, 0, 0, 1, 0, 0]


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
                pen.addPoint(tuple(node.position), segmentType=node_type, smooth=node.smooth)
        pen.endPath();

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


def makeKerning(font, master):
    fea = ""

    groups = {}
    for glyph in font.glyphs:
        if glyph.leftKerningGroup:
            group = f"@MMK_R_{glyph.leftKerningGroup}"
            if group not in groups:
                groups[group] = []
            groups[group].append(glyph.name)
        if glyph.rightKerningGroup:
            group = f"@MMK_L_{glyph.rightKerningGroup}"
            if group not in groups:
                groups[group] = []
            groups[group].append(glyph.name)
    for group, glyphs in groups.items():
        fea += f"{group} = [{' '.join(glyphs)}];\n"

    kerning = font.kerning[master.id]
    pairs = ""
    classes = "";
    enums = "";
    for left in kerning:
        for right in kerning[left]:
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
feature kern {{
lookupflag IgnoreMarks;
{pairs}
{enums}
{classes}
}} kern;
"""

    return fea


def getLayer(glyph, instance):
    for layer in glyph.layers:
        if layer.name == f"{{{instance.weightValue}}}":
            return layer
    return glyph.layers[0]


def makeMark(instance):
    font = instance.parent

    fea = ""
    mark = ""
    curs = ""
    liga = ""

    exit = {}
    entry = {}
    lig = {}

    for glyph in font.glyphs:
        if not glyph.export:
            continue

        layer = getLayer(glyph, instance)
        for anchor in layer.anchors:
            name, x, y = anchor.name, anchor.position.x, anchor.position.y
            if name.startswith("_"):
                fea += f"markClass {glyph.name} <anchor {x} {y}> @mark_{name[1:]};\n"
            elif name.startswith("caret_"):
                pass
            elif "_" in name:
                name, index = name.split("_")
                if glyph.name not in lig:
                    lig[glyph.name] = {}
                if index not in lig[glyph.name]:
                    lig[glyph.name][index] = []
                lig[glyph.name][index].append((name, (x, y)))
            elif name == "exit":
                exit[glyph.name] = (x, y)
            elif name == "entry":
                entry[glyph.name] = (x, y)
            else:
                mark += f"pos base {glyph.name} <anchor {x} {y}> mark @mark_{name};\n"

    for name, components in lig.items():
        mark += f"pos ligature {name}"
        for component, anchors in components.items():
            if component != "1":
                mark += " ligComponent"
            for anchor, (x, y) in anchors:
                mark += f" <anchor {x} {y}> mark @mark_{anchor}"
        mark += ";\n"

    for glyph in font.glyphs:
        if glyph.name in exit or glyph.name in entry:
            pos1 = entry.get(glyph.name)
            pos2 = exit.get(glyph.name)
            anchor1 = pos1 and f"{pos1[0]} {pos1[1]}" or "NULL"
            anchor2 = pos2 and f"{pos2[0]} {pos2[1]}" or "NULL"
            curs += f"pos cursive {glyph.name} <anchor {anchor1}> <anchor {anchor2}>;\n"

    fea += f"""
feature curs {{
lookupflag IgnoreMarks RightToLeft;
{curs}
}} curs;
feature mark {{
{mark}
}} mark;
"""

    return fea


def makeFeatures(instance, master):
    font = instance.parent

    fea = ""
    for gclass in font.classes:
        if gclass.disabled:
            continue
        fea += f"@{gclass.name} = [{gclass.code}];\n"

    for prefix in font.featurePrefixes:
        if prefix.disabled:
            continue
        fea += prefix.code

    for feature in font.features:
        if feature.disabled:
            continue
        if feature.name == "mark":
            fea += makeMark(instance)

        fea += f"""
            feature {feature.name} {{
            {feature.code}
            }} {feature.name};
        """
        if feature.name == "kern":
            fea += makeKerning(font, master)

    marks = set()
    carets = ""
    for glyph in font.glyphs:
        if not glyph.export:
            continue

        if glyph.category and glyph.subCategory:
            if glyph.category == "Mark" and glyph.subCategory == "Nonspacing":
                marks.add(glyph.name)
        else:
            layer = getLayer(glyph, instance)
            caret = ""
            for anchor in layer.anchors:
                if anchor.name.startswith("_"):
                    marks.add(glyph.name)
                elif anchor.name.startswith("caret_"):
                    _, index = anchor.name.split("_")
                    if not caret:
                        caret = f"LigatureCaretByPos {glyph.name}"
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

    #with open(f"{instance.fontName}.fea", "w") as f:
    #    f.write(fea)
    return fea


def calcFsSelection(instance):
    font = instance.parent
    fsSelection = 0
    if font.customParameters["Use Typo Metrics"]:
        fsSelection |= (1 << 7)
    if instance.isItalic:
        fsSelection |= (1 << 1)
    if instance.isBold:
        fsSelection |= (1 << 5)
    if not (instance.isItalic or instance.isBold):
        fsSelection |= (1 << 6)

    return fsSelection


def build(instance):
    font = instance.parent
    master = font.masters[0]

    glyphOrder = []
    advanceWidths = {}
    characterMap = {}
    charStrings = {}
    colorLayers = {}
    for glyph in font.glyphs:
        if not glyph.export:
            continue
        name = glyph.name
        for layer in glyph.layers:
            if layer.name.startswith("Color "):
                _, index = layer.name.split(" ")
                if name not in colorLayers:
                    colorLayers[name] = []
                colorLayers[name].append((name, int(index)))

        glyphOrder.append(name)
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

    version = float(f"{font.versionMajor}.{font.versionMinor:03}")

    vendor = font.customParameters["vendorID"]
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
        "licenseDescription": font.customParameters["license"],
        "licenseInfoURL": font.customParameters["licenseURL"],
        "sampleText": font.customParameters["sampleText"],
    }

    fb = FontBuilder(font.upm, isTTF=False)
    fb.updateHead(fontRevision=version)
    fb.setupGlyphOrder(glyphOrder)
    fb.setupCharacterMap(characterMap)
    fb.setupNameTable(names, mac=False)
    fb.setupHorizontalHeader(ascent=master.ascender, descent=master.descender,
                             lineGap=master.customParameters['hheaLineGap'])

    privateDict = {"BlueValues": [], "OtherBlues": []}
    for zone in sorted(master.alignmentZones):
        pos = zone.position
        size = zone.size
        vals = privateDict["BlueValues"] if pos == 0 or size >= 0 else privateDict["OtherBlues"]
        vals.extend(sorted((pos, pos + size)))

    #fb.setupCFF(names["psName"], {}, charStrings, privateDict)
    fb.setupCFF2(charStrings, [privateDict])

    metrics = {}
    for name, width in advanceWidths.items():
        bounds = charStrings[name].calcBounds(None) or [0]
        metrics[name] = (width, bounds[0])
    fb.setupHorizontalMetrics(metrics)

   #fsType = font.customParameters["fsType"] or 0 # XXX
   #fb.setupOS2(version=4, sTypoAscender=master.ascender,
   #            sTypoDescender=master.descender,
   #            sTypoLineGap=master.customParameters['typoLineGap'],
   #            usWinAscent=master.ascender, usWinDescent=-master.descender,
   #            sxHeight=master.xHeight, sCapHeight=master.capHeight,
   #            achVendID=vendor, fsType=fsType,
   #            fsSelection=calcFsSelection(instance))

    fb.setupPost()

    fea = makeFeatures(instance, master)
    fb.addOpenTypeFeatures(fea)

    palettes = master.customParameters["Color Palettes"]
    CPAL = newTable("CPAL")
    CPAL.version = 0
    CPAL.palettes = []
    CPAL.numPaletteEntries = len(palettes[0])
    Color = getTableModule("CPAL").Color
    for palette in palettes:
        CPAL.palettes.append([])
        for c in palette:
            c = [int(v) for v in c.split(",")]
            CPAL.palettes[-1].append(Color(red=c[0], green=c[1], blue=c[2], alpha=c[3]))
    fb.font["CPAL"] = CPAL

    COLR = newTable("COLR")
    COLR.version = 0
    COLR.ColorLayers = {}
    LayerRecord = getTableModule("COLR").LayerRecord
    for name in colorLayers:
        layers = colorLayers[name]
        COLR[name] = [LayerRecord(name=l[0], colorID=l[1]) for l in layers]
    fb.font["COLR"] = COLR

    instance.font = fb.font
    axes = [
        instance.weightValue,
        instance.widthValue,
        instance.customValue,
        instance.customValue1,
        instance.customValue2,
        instance.customValue3,
    ]
    instance.axes = {}
    for i, axis in enumerate(font.customParameters["Axes"]):
        instance.axes[axis["Tag"]] = axes[i]

    return fb.font


def buildVF(font):
    for instance in font.instances:
        print(f" MASTER\t{instance.name}")
        build(instance)
        if instance.name == "Regular":
            regular = instance

    ds = DesignSpaceDocument()

    for axisDef in font.customParameters["Axes"]:
        axis = ds.newAxisDescriptor()
        axis.tag = axisDef["Tag"]
        axis.name = axisDef["Name"]
        axis.maximum = max(i.axes[axis.tag] for i in font.instances)
        axis.minimum = min(i.axes[axis.tag] for i in font.instances)
        axis.default = regular.axes[axis.tag]
        ds.addAxis(axis)

    for instance in font.instances:
        source = ds.newSourceDescriptor()
        source.font = instance.font
        source.familyName = instance.familyName
        source.styleName = instance.name
        source.name = instance.fullName
        source.location = {a.name: instance.axes[a.tag] for a in ds.axes}
        ds.addSource(source)

    print(f" MERGE\t{sys.argv[2]}")
    otf, _, _ = merge(ds)
    return otf


def propogateAnchors(glyph):
    for layer in glyph.layers:
        for component in layer.components:
            for anchor in (component.layer or component.component.layers[0]).anchors:
                name = anchor.name
                if name.startswith("_") or name in layer.anchors:
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
        propogateAnchors(glyph)


def main():
    font = GSFont(sys.argv[1])
    prepare(font)
    otf = buildVF(font)
    otf.save(sys.argv[2])

main()
