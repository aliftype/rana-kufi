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

from glyphsLib import GSFont, GSGlyph, GSLayer, GSFeature


def addCvFeatures(font, glyphOrder):
    fea = ""
    features = {}
    for name in glyphOrder:
        if name.count(".") >= 2:
            base, tag, index = name.rsplit(".", 2)
            try:
                tag = int(tag)
                index = int(index)
            except ValueError:
                continue
            tag = f"cv{tag:02d}"
            if tag not in features:
                features[tag] = {}
            if base not in features[tag]:
                features[tag][base] = []
            features[tag][base].append(name)

    index = -1
    for i, feature in enumerate(font.features):
        if feature.name == "dist":
            index = i + 1
            break

    for tag, subs in features.items():
        code = ""
        for base, alts in subs.items():
            code += f"sub {base} from [{' '.join(alts)}];\n"
        feature = GSFeature(tag, code)
        font.features.insert(index, feature)
        index += 1

    return fea


def updateAutomaticClasses(font, glyphOrder):
    from glyphsLib.glyphdata import get_glyph as getGlyphInfo

    for gclass in font.classes:
        if gclass.disabled:
            continue
        if gclass.name == "AllLetters" and gclass.automatic:
            glyphs = [n for n in glyphOrder if getGlyphInfo(n).category == "Letter"]
            gclass.code = " ".join(glyphs)


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
            for attr in {"name", "width", "layerId", "associatedMasterId"}:
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
        if name.startswith("_alt.") and not "." in name[len("_alt.") :]:
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


def buildVF(opts):
    font = GSFont(opts.glyphs)
    glyphOrder = buildAltGlyphs(font)
    updateAutomaticClasses(font, glyphOrder)
    addCvFeatures(font, glyphOrder)
    font.customParameters["glyphOrder"] = glyphOrder
    return font


def main():
    from pathlib import Path

    parser = argparse.ArgumentParser(description="Build Rana Kufi.")
    parser.add_argument("glyphs", help="input Glyphs source file", type=Path)
    parser.add_argument("version", help="font version")
    parser.add_argument("output", help="output Glyphs file", type=Path)
    args = parser.parse_args()

    font = buildVF(args)
    font.save(args.output)


main()
