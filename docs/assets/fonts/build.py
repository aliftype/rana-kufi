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

from fontTools.ttLib import TTFont, newTable, getTableModule
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.pointPen import PointToSegmentPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from glyphsLib import GSFont


DEFAULT_TRANSFORM = [1, 0, 0, 1, 0, 0]


def draw(layer, layerName, pen=None):
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
        componentGlyph = font.glyphs[component.componentName]
        componentLayer = componentGlyph.layers[0]
        for layer in componentGlyph.layers:
            if layer.name == layerName:
                componentLayer = layer
        transform = component.transform.value
        componentPen = pen.pen
        if transform != DEFAULT_TRANSFORM:
            componentPen = TransformPen(pen.pen, transform)
            xx, xy, yx, yy = transform[:4]
            if xx * yy - xy * yx < 0:
                componentPen = ReverseContourPen(componentPen)
        draw(componentLayer, layerName, componentPen)

    return pen.pen


def build(instance):
    font = instance.parent
    master = font.masters[0]
    layerName = f"{{{instance.weightValue}}}"

    glyphOrder = []
    advanceWidths = {}
    characterMap = {}
    charStrings = {}
    colorLayers = {}
    for glyph in font.glyphs:
        if not glyph.export:
            continue

        name = glyph.name.replace("-", "")
        layer = glyph.layers[0]
        for l in glyph.layers:
            if l.name == layerName:
                layer = l
            if l.name.startswith("Color "):
                _, index = l.name.split(" ")
                if name not in colorLayers:
                    colorLayers[name] = []
                colorLayers[name].append((name, int(index)))

        glyphOrder.append(name)
        if glyph.unicode:
            characterMap[int(glyph.unicode, 16)] = name

        charStrings[name] = draw(layer, layerName).getCharString()
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
    fb.setupHorizontalHeader(ascent=master.ascender, descent=master.descender,
                             lineGap=master.customParameters['hheaLineGap'])

    privateDict = {"BlueValues": [], "OtherBlues": []}
    for zone in sorted(master.alignmentZones):
        pos = zone.position
        size = zone.size
        vals = privateDict["BlueValues"] if pos == 0 or size >= 0 else privateDict["OtherBlues"]
        vals.extend(sorted((pos, pos + size)))

    fb.setupCFF(names["psName"], {}, charStrings, privateDict)

    metrics = {}
    for name, advanceWidth in advanceWidths.items():
        bounds = charStrings[name].calcBounds(None) or [0]
        metrics[name] = (advanceWidth, bounds[0])
    fb.setupHorizontalMetrics(metrics)

    fb.setupNameTable(names, mac=False)
    
    fsType = font.customParameters["fsType"] or 0 # XXX
    fsSelection = 0
    if font.customParameters["Use Typo Metrics"]:
        fsSelection = fsSelection | (1 << 7)
    if instance.isItalic:
        fsSelection = fsSelection | (1 << 1)
    if instance.isBold:
        fsSelection = fsSelection | (1 << 5)
    if not (instance.isItalic or instance.isBold):
        fsSelection = fsSelection | (1 << 6)
    fb.setupOS2(version=4, sTypoAscender=master.ascender,
                sTypoDescender=master.descender,
                sTypoLineGap=master.customParameters['typoLineGap'],
                usWinAscent=master.ascender, usWinDescent=-master.descender,
                sxHeight=master.xHeight, sCapHeight=master.capHeight,
                achVendID=vendor, fsType=fsType, fsSelection=fsSelection)

    fb.setupPost()

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

    fb.save(f"test{instance.name}.otf")
    f = TTFont(f"test{instance.name}.otf")
    f.saveXML(f"test{instance.name}.ttx")


def main():
    font = GSFont(sys.argv[1])
    for instance in font.instances:
        if instance.active:
            build(instance)

main()
