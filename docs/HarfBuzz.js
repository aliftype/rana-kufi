function TAG(tag) {
  tag = tag.padEnd(4, " ");
  let c1 = tag.codePointAt(0);
  let c2 = tag.codePointAt(1);
  let c3 = tag.codePointAt(2);
  let c4 = tag.codePointAt(3);
  return (c1&0xFF) << 24 | (c2&0xFF) << 16 | (c3&0xFF) << 8 | c4&0xFF;
}

class Stream {
  constructor(bytes) {
    this.bytes = bytes;
    this.start = 0;
    this.end = bytes.length;
    this.pos = this.start;
  }

  skip(length) {
    this.pos += length;
  }

  skipTo(pos) {
    this.pos = pos;
  }

  readByte(pos) {
    if (pos !== undefined)
      this.skipTo(pos)
    return this.bytes[this.pos++];
  }

  readUInt16(pos) {
    let b0 = this.readByte(pos);
    let b1 = this.readByte();
    return (b0 << 8) + b1;
  }

  readInt16(pos) {
    let v = this.readUInt16(pos);
    return (v << 16) >> 16;
  }

  readUInt32(pos) {
    let b0 = this.readByte(pos);
    let b1 = this.readByte();
    let b2 = this.readByte();
    let b3 = this.readByte();
    return (b0 << 24) + (b1 << 16) + (b2 << 8) + b3;
  }

  readTag(pos) {
    let b0 = this.readByte(pos);
    let b1 = this.readByte();
    let b2 = this.readByte();
    let b3 = this.readByte();
    return String.fromCodePoint(b0, b1, b2, b3);
  }
}

class Coverage {
  constructor(stream, offset) {
    this.glyphs = [];

    let pos = stream.pos;

    let coverageFormat = stream.readUInt16(offset);
    switch (coverageFormat) {
      case 1:
        let glyphCount = stream.readUInt16();
        for (let i = 0; i < glyphCount; i++)
          this.glyphs.push(stream.readUInt16());
        break;

      case 2:
        let rangeCount = stream.readUInt16();
        for (let i = 0; i < rangeCount; i++) {
          let startGlyphID = stream.readUInt16();
          let endGlyphID = stream.readUInt16();
          let startCoverageIndex = stream.readUInt16();
          for (let j = 0; j <= endGlyphID - startGlyphID; j++)
            this.glyphs[startCoverageIndex + j] = startGlyphID + j;
        }
        break;

      default:
        console.log("Unsupported coverage format:", coverageFormat);
    }

    stream.pos = pos;
  }
}


class Lookup {
  constructor(stream, lookupOffset) {
    this.mapping = {};

    let pos = stream.pos;

    this.type = stream.readUInt16(lookupOffset);
    this.flag = stream.readUInt16();
    let subtableCount = stream.readUInt16();

    let subtableOffsets = []
    for (let i = 0; i < subtableCount; i++)
      subtableOffsets.push(lookupOffset + stream.readUInt16());

    if (this.flag & 0x0010)
      this.markFilteringSet = stream.readUInt16();

    for (const subtableOffset of subtableOffsets) {
      switch (this.type) {
        case 1: {
          let substFormat = stream.readUInt16(subtableOffset);
          switch (substFormat) {
            case 1: {
              let coverage = new Coverage(stream, subtableOffset + stream.readUInt16());
              let deltaGlyphID = stream.readInt16();
              for (let glyphID of coverage.glyphs)
                this.mapping[glyphID] = glyphID + deltaGlyphID;
            }
            break;

            case 2: {
              let coverage = new Coverage(stream, subtableOffset + stream.readUInt16());
              let glyphCount = stream.readUInt16();
              let substituteGlyphIDs = [];
              for (let i = 0; i < glyphCount; i++)
                this.mapping[coverage.glyphs[i]] = stream.readUInt16();
            }
            break;

            default:
              console.log("Unsupported single substitution subtable format:",
                          substFormat);
          }
        }
        break;

        case 2: {
          let substFormat = stream.readUInt16(subtableOffset);
          switch (substFormat) {
            case 1: {
              let coverage = new Coverage(stream, subtableOffset + stream.readUInt16());
              let sequenceCount = stream.readUInt16();
              for (let i = 0; i < sequenceCount; i++) {
                let sequenceOffset = subtableOffset + stream.readUInt16(subtableOffset + 4 + (i * 2));
                let glyphCount = stream.readUInt16(sequenceOffset);
                this.mapping[coverage.glyphs[i]] = [];
                for (let j = 0; j < glyphCount; j++)
                  this.mapping[coverage.glyphs[i]].push(stream.readUInt16());
              }
            }
            break;

            default:
              console.log("Unsupported multiple substitution subtable format:",
                          substFormat);
          }
        }
        break;

        case 4: {
          let substFormat = stream.readUInt16(subtableOffset);
          switch (substFormat) {
            case 1: {
              let coverage = new Coverage(stream, subtableOffset + stream.readUInt16());
              let ligatureSetCount = stream.readUInt16();
              for (let i = 0; i < ligatureSetCount; i++) {
                let ligatureSetOffset = subtableOffset + stream.readUInt16(subtableOffset + 6 + (i * 2));
                let ligatureCount = stream.readUInt16(ligatureSetOffset);
                for (let j = 0; j < ligatureCount; j++) {
                  let ligatureOffset = ligatureSetOffset + stream.readUInt16(ligatureSetOffset + 2 + (j * 2));
                  let ligatureGlyph = stream.readUInt16(ligatureOffset);
                  let componentCount = stream.readUInt16();
                  let componentGlyphIDs = [coverage.glyphs[i]];
                  for (let k = 0; k < componentCount - 1; k++)
                    componentGlyphIDs.push(stream.readUInt16());
                  this.mapping[componentGlyphIDs] = ligatureGlyph;
                }
              }
            }
            break;

            default:
              console.log("Unsupported ligature substitution subtable format:",
                          substFormat);
          }
        }
        break;

        default:
          console.log("Unsupported lookup type:", this.type);
      }
    }

    stream.pos = pos;
  }
}

class GSUB {
  constructor(data) {
    this.stream = new Stream(data);

    this.major = this.stream.readUInt16();
    this.minor = this.stream.readUInt16();
    this._scriptListOffset = this.stream.readUInt16();
    this._featureListOffset = this.stream.readUInt16();
    this._lookupListOffset = this.stream.readUInt16();

    this._scripts = null;
    this._features = null;
    this._lookupOffsets = null;
    this._lookups = [];
  }

  get features() {
    if (this._features == null) {
      let pos = this.stream.pos;

      let featureListOffset = this._featureListOffset;

      let featureCount = this.stream.readUInt16(featureListOffset);
      let featureOffsets = [];
      for (let i = 0; i < featureCount; i++) {
        let featureTag = this.stream.readTag();
        featureOffsets.push([featureTag, featureListOffset + this.stream.readUInt16()]);
      }

      let features = {};
      for (const [featureTag, featureOffset] of featureOffsets) {
        features[featureTag] = [];

        let featureParams = this.stream.readUInt16(featureOffset);
        let lookupIndexCount = this.stream.readUInt16();
        for (let j = 0; j < lookupIndexCount; j++) {
          let lookupIndex = this.stream.readUInt16();
          features[featureTag].push(lookupIndex);
        }
      }
      this._features = features;

      this.stream.pos = pos;
    }

    return this._features;
  }

  lookup(index) {
    if (this._lookups[index] == undefined) {
      if (this._lookupOffsets == null) {
        let pos = this.stream.pos;

        let lookupListOffset = this._lookupListOffset;
        let lookupCount = this.stream.readUInt16(lookupListOffset);
        let lookupOffsets = [];
        for (let i = 0; i < lookupCount; i++)
          lookupOffsets.push(lookupListOffset + this.stream.readUInt16());

        this._lookupOffsets = lookupOffsets;
        this.stream.pos = pos;
      }
      this._lookups[index] = new Lookup(this.stream, this._lookupOffsets[index]);
    }

    return this._lookups[index];
  }
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
    this.ptr = _layout_get_font(dpr);
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
        let r = _hb_color_get_red(color);
        let g = _hb_color_get_green(color);
        let b = _hb_color_get_blue(color);
        let a = _hb_color_get_alpha(color);
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

  getSubstitute(lookupIndex, glyph, prev, next) {
    let lookup = this.GSUB.lookup(lookupIndex);
    if (prev) {
      let res = lookup.mapping[[prev, glyph]];
      if (res)
        return res;
    }

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

  getSubstitutes(prev, next) {
    if (this._features === null) {
      let required = ["init", "medi", "fina", "rlig", "dist", "ccmp"];
      let features = this.font.GSUB.features;
      let result = new Set();
      for (const [tag, lookups] of Object.entries(features)) {
        if (!required.includes(tag)) {
          for (const lookup of lookups) {
            let sub = this.font.getSubstitute(lookup, this.index, prev && prev.index, next && next.index);
            if (sub)
              result.add([tag, sub]);
          }
        }
      }
      this._features = result.size && result || undefined;
    }
    return this._features;
  }
}

export class Buffer {
  constructor() { this.ptr = _hb_buffer_create(); }

  shape(font, text, useFeatures) {
    _hb_buffer_clear_contents(this.ptr);
    _hb_buffer_set_direction(this.ptr, 5/*rtl*/);
    _hb_buffer_set_script(this.ptr, _hb_script_from_iso15924_tag(TAG("Arab")));
    _hb_buffer_set_content_type(this.ptr, 1/*unicode*/);

    if (useFeatures) {
      let features = [];
      for (let i = 0; i < text.length; i++) {
        _hb_buffer_add(this.ptr, text[i].code, i);
        for (const feature of text[i].features || []) {
          features.push(TAG(feature), 1, i, i + 1);
        }
      }

      let featuresPtr = new Pointer(new Uint32Array(features).buffer);
      _hb_shape(font.ptr, this.ptr, featuresPtr.ptr, features.length / 4);
    } else {
      for (let i = 0; i < text.length; i++)
        _hb_buffer_add(this.ptr, text[i].code, i);
      _hb_shape(font.ptr, this.ptr, 0, 0);
    }

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
