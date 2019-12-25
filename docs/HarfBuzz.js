function TAG(tag) {
  tag = tag.padEnd(4, " ");
  let c1 = tag.codePointAt(0);
  let c2 = tag.codePointAt(1);
  let c3 = tag.codePointAt(2);
  let c4 = tag.codePointAt(3);
  return (c1&0xFF) << 24 | (c2&0xFF) << 16 | (c3&0xFF) << 8 | c4&0xFF;
}

function UNTAG(tag) {
  let c1 = (tag>>24)&0xFF
  let c2 = (tag>>16)&0xFF
  let c3 = (tag>>8)&0xFF
  let c4 = tag&0xFF;
  return String.fromCodePoint(c1, c2, c3, c4);
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
    this._gsub_features = null;
    this._gsub_lookups = [];
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

  getGSUBFeatureTags() {
    if (this._gsub_features === null) {
      let nFeaturesPtr = new Pointer(4);
      nFeaturesPtr.uint32 = 255;
      let featuresPtr = new Pointer(nFeaturesPtr.uint32 * 4);

      _hb_ot_layout_table_get_feature_tags(this.face, TAG("GSUB"), 0, nFeaturesPtr.ptr, featuresPtr.ptr);
      this._gsub_features = new Set(featuresPtr.asUint32Array().slice(0, nFeaturesPtr.uint32));
    }
    return this._gsub_features;
  }

  getGSUBFeatureLookups(feature) {
    if (this._gsub_lookups[feature] === undefined) {
      let featuresPtr = new Pointer(new Uint32Array([feature, 0]).buffer);
      let lookupsPtr = _hb_set_create();
      _hb_ot_layout_collect_lookups(this.face, TAG("GSUB"), 0, 0, featuresPtr.ptr, lookupsPtr);

      let idxPtr = new Pointer(4);
      idxPtr.uint32 = 0xFFFFFFFF /*HB_SET_VALUE_INVALID*/;
      let lookups = []
      while (_hb_set_next(lookupsPtr, idxPtr.ptr))
        lookups.push(idxPtr.uint32)
      this._gsub_lookups[feature] = lookups;
    }
    return this._gsub_lookups[feature];
  }

  _wouldSubstitute(lookup, glyphPtr) {
    return _hb_ot_layout_lookup_would_substitute(this.face, lookup, glyphPtr.ptr, glyphPtr.byteLength / 4, false);
  }

  wouldSubstitute(lookup, glyph, prev, next) {
    let glyphPtr;

    if (prev) {
      glyphPtr = new Pointer(new Uint32Array([prev, glyph]).buffer);
      if (this._wouldSubstitute(lookup, glyphPtr))
        return true;
    }

    if (next) {
      glyphPtr = new Pointer(new Uint32Array([glyph, next]).buffer);
      if (this._wouldSubstitute(lookup, glyphPtr))
        return true;
    }
    glyphPtr = new Pointer(new Uint32Array([glyph]).buffer);
    return this._wouldSubstitute(lookup, glyphPtr);
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

  getFeatures(prev, next) {
    if (this._features === null) {
      let required = [TAG("init"), TAG("medi"), TAG("fina"), TAG("rlig"),
                      TAG("dist"), TAG("ccmp")];
      let tags = this.font.getGSUBFeatureTags();
      let features = new Set();
      for (const tag of tags) {
        if (!required.includes(tag)) {
          let lookups = this.font.getGSUBFeatureLookups(tag);
          for (const lookup of lookups) {
            if (this.font.wouldSubstitute(lookup, this.index, prev && prev.index, next && next.index)) {
              features.add(UNTAG(tag));
            }
          }
        }
      }
      this._features = features.size && features || undefined;
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
