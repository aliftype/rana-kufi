/*
 * Copyright (c) 2019 Khaled Hosny
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 *
 * Copyright (c) 2019 Ebrahim Byagowi
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

import { GSUB } from "./OpenType.js"

function TAG(tag) {
  tag = tag.padEnd(4, " ");
  let c1 = tag.codePointAt(0);
  let c2 = tag.codePointAt(1);
  let c3 = tag.codePointAt(2);
  let c4 = tag.codePointAt(3);
  return (c1&0xFF) << 24 | (c2&0xFF) << 16 | (c3&0xFF) << 8 | c4&0xFF;
}

class Pointer {
  constructor(arg1, arg2) {
    if (arg2 !== undefined) {
      this.ptr = arg1;
      this.byteLength = arg2;
    } else if (arg1 instanceof ArrayBuffer) {
      this.byteLength = arg1.byteLength;
      this.ptr = stackAlloc(this.byteLength);
      HEAPU8.set(new Uint8Array(arg1), this.ptr);
    } else {
      this.byteLength = arg1;
      this.ptr = stackAlloc(this.byteLength);
    }
  }

  asInt8Array()   { return HEAP8.slice(this.ptr, this.ptr + this.byteLength); }
  asUint8Array()  { return HEAPU8.slice(this.ptr, this.ptr + this.byteLength); }
  asInt32Array()  { return HEAP32.slice(this.ptr / 4, (this.ptr + this.byteLength) / 4); }
  asUint32Array() { return HEAPU32.slice(this.ptr / 4, (this.ptr + this.byteLength) / 4); }

  set int32(v)  { HEAP32[this.ptr / 4] = v; }
  get int32()   { return HEAP32[this.ptr / 4]; }

  set uint32(v) { HEAPU32[this.ptr / 4] = v; }
  get uint32()  { return HEAPU32[this.ptr / 4]; }
}

export class Font {
  constructor(dpr) {
    this.ptr = _get_font(dpr);
    this.face = _hb_font_get_face(this.ptr);
    this.upem = _hb_face_get_upem(this.face);

    let scale = this.upem * dpr;
    _hb_font_set_scale(this.ptr, scale, scale);

    this._outlines = [];
    this._extents = [];
    this._layers = [];
    this._gsub = null;
  }

  getGlyphExtents(glyph) {
    if (this._extents[glyph] !== undefined)
      return this._extents[glyph];

    let extentsPtr = new Pointer(4 * 4);
    _hb_font_get_glyph_extents(this.ptr, glyph, extentsPtr.ptr);

    let extents = extentsPtr.asInt32Array();
    this._extents[glyph] = {
      x_bearing: extents[0],
      y_bearing: extents[1],
      width: extents[2],
      height: extents[3],
    };
    return this._extents[glyph];
  }

  getGlyphName(glyph) {
    let namePtr = new Pointer(100);
    if (_hb_font_get_glyph_name(this.ptr, glyph, namePtr.ptr, namePtr.byteLength)) {
      return UTF8ToString(namePtr.ptr, namePtr.byteLength);
    }
    return "";
  }

  getColorPalettes() {
    if (this._palettes !== undefined)
      return this._palettes;

    let face = this.face;

    if (!_hb_ot_color_has_palettes(face))
      return [];

    let nPalettes = _hb_ot_color_palette_get_count(face);
    let ret = [];
    for (let i = 0; i < nPalettes; i++) {
      let nColors = _hb_ot_color_palette_get_colors(face, i, 0, 0, 0);

      let lenPtr = new Pointer(4);
      lenPtr.int32 = nColors;
      let colorsPtr = new Pointer(nColors * 4);

      _hb_ot_color_palette_get_colors(face, i, 0, lenPtr.ptr, colorsPtr.ptr);
      let colors = colorsPtr.asInt32Array();
      let rgbs = [];
      for (let j = 0; j < nColors; j++) {
        let color = colors[i];
        let r = (color >> 8) & 0xFF;
        let g = (color >> 16) & 0xFF;
        let b = (color >> 24) & 0xFF;
        let a = color & 0xFF;
        let rgb = `#${r.toString(16)}${g.toString(16)}${b.toString(16)}`;
        // Inkscape!
        if (a !== 255)
          rgb += a.toString(16);
        rgbs.push(rgb);
      }

      ret.push(rgbs);
    }
    this._palettes = ret;

    return this._palettes;
  }

  getGlyphColorLayers(glyph) {
    if (this._layers[glyph] !== undefined)
      return this._layers[glyph];

    let face = this.face;

    let nLayers = _hb_ot_color_glyph_get_layers(face, glyph, 0, 0, 0);
    if (nLayers === 0)
      return [];

    let lenPtr = new Pointer(4);
    lenPtr.uint32 = nLayers;

    let layersPtr = new Pointer(nLayers * 8);
    _hb_ot_color_glyph_get_layers(face, glyph, 0, lenPtr.ptr, layersPtr.ptr);

    let palettes = this.getColorPalettes();
    let layers = layersPtr.asUint32Array();
    let ret = [];
    for (let i = 0; i < nLayers; ++i) {
      ret.push({
        index: layers[i + 0],
        color: palettes[0][layers[i + 1]],
      });
    }
    this._layers[glyph] = ret;
    return this._layers[glyph];
  }

  getGlyphOutline(glyph) {
    if (this._outlines[glyph] !== undefined)
      return this._outlines[glyph];

    let nCommandsPtr = new Pointer(4);
    let nCoordsPtr = new Pointer(4);
    let path = _hb_ot_glyph_path_create_from_font(this.ptr, glyph);
    let commandsPtr = _hb_ot_glyph_path_get_commands(path, nCommandsPtr.ptr);
    let coordsPtr = _hb_ot_glyph_path_get_coords(path, nCoordsPtr.ptr);

    let cmdPtr = new Pointer(commandsPtr, nCommandsPtr.int32);
    let cooPtr = new Pointer(coordsPtr, nCoordsPtr.int32 * 4);

    let commands = cmdPtr.asUint8Array();
    let coords = cooPtr.asInt32Array();

    let ret = "";
    let i = 0;
    for (const c of commands) {
      let command = String.fromCodePoint(c);
      ret += command;
      if (command === "C") {
        ret += `${coords[i++]},${-coords[i++]},`;
        ret += `${coords[i++]},${-coords[i++]},`;
        ret += `${coords[i++]},${-coords[i++]}`;
      } else if (command === "Q") {
        ret += `${coords[i++]},${-coords[i++]},`;
        ret += `${coords[i++]},${-coords[i++]}`;
      } else if (command !== "Z") {
        ret += `${coords[i++]},${-coords[i++]}`;
      }
    }
    ret += "Z";

    _hb_ot_glyph_path_destroy(path);
    this._outlines[glyph] = ret;

    return this._outlines[glyph];
  }

  get GSUB() {
    if (this._gsub == null) {
      let lenPtr = new Pointer(4);
      let blob = _hb_face_reference_table(this.face, TAG("GSUB"));
      let data = _hb_blob_get_data(blob, lenPtr.ptr);
      this._gsub = new GSUB(HEAPU8.slice(data, data + lenPtr.uint32));
    }
    return this._gsub;
  }

  getSubstitute(lookupIndex, glyph, next) {
    let lookup = this.GSUB.lookup(lookupIndex);

    if (next) {
      let res = lookup.mapping[[glyph, next]];
      if (res)
        return res;
    }

    return lookup.mapping[glyph];
  }

  get extents() {
    let extentsPtr = new Pointer(12 * 4);
    _hb_font_get_h_extents(this.ptr, extentsPtr.ptr);
    let extents = extentsPtr.asInt32Array();
    return {
      ascender: extents[0],
      descender: extents[1],
      line_gap: extents[2],
    };
  }
}

class Glyph {
  constructor(font, info, position) {
    this.font = font;
    this.index = info[0];
    this.cl = info[2];
    this.ax = position[0];
    this.ay = position[1];
    this.dx = position[2];
    this.dy = position[3];

    this._features = null;
  }

  get isDot() {
    let name = this.font.getGlyphName(this.index);
    return name.includes("dot");
  }
  get layers() {
    let layers = this.font.getGlyphColorLayers(this.index);
    return layers.map(l => {
      let glyph = {...this, index: l.index, color: l.color};
      Object.setPrototypeOf(glyph, Glyph.prototype);
      return glyph;
    });
  }
  get outline() { return this.font.getGlyphOutline(this.index); }

  getSubstitutes(next) {
    if (this._features === null) {
      let required = ["init", "medi", "fina", "rlig", "dist", "ccmp"];
      let features = this.font.GSUB.features;
      let result = new Set();
      for (const [tag, lookups] of Object.entries(features)) {
        if (!required.includes(tag)) {
          for (const lookup of lookups) {
            let sub = this.font.getSubstitute(lookup, this.index, next && next.index);
            if (sub)
              result.add([tag, sub]);
          }
        }
      }
      this._features = result.size && Array.from(result) || undefined;
      if (this._features)
        this._features.unshift([null, this.index])
    }
    return this._features;
  }
}

export class Buffer {
  constructor() { this.ptr = _hb_buffer_create(); }

  shape(font, text, useFeatures) {
    _hb_buffer_clear_contents(this.ptr);
    _hb_buffer_set_direction(this.ptr, 5/*rtl*/);
    _hb_buffer_set_script(this.ptr, TAG("Arab"));
    _hb_buffer_set_content_type(this.ptr, 1/*unicode*/);

    let features = [];
    for (let i = 0; i < text.length; i++) {
      _hb_buffer_add(this.ptr, text[i].code, i);
      for (const feature of text[i].features || []) {
        if (useFeatures || feature == "dlig")
          features.push(TAG(feature), 1, i, i + 1);
      }
    }

    let featuresPtr = new Pointer(new Uint32Array(features).buffer);
    _hb_shape(font.ptr, this.ptr, featuresPtr.ptr, features.length / 4);

    let length = _hb_buffer_get_length(this.ptr);
    let infosPtr32 = _hb_buffer_get_glyph_infos(this.ptr, 0) / 4;
    let positionsPtr32 = _hb_buffer_get_glyph_positions(this.ptr, 0) / 4;
    let infos = HEAPU32.slice(infosPtr32, infosPtr32 + 5 * length);
    let positions = HEAP32.slice(positionsPtr32, positionsPtr32 + 5 * length);
    let glyphs = [];
    for (let i = 0; i < length; ++i) {
      let j = i * 5;
      let info = infos.slice(j, j + 5);
      let position = positions.slice(j, j + 5);
      glyphs.push(new Glyph(font, info, position));
    }
    return glyphs;
  }
}
