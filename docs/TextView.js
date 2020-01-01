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
 */

import * as HarfBuzz from "./HarfBuzz.js"

class Layout {
  constructor(font, buffer, text) {
    this._font = font;
    this._buffer = buffer;
    this._text = text.map(c => ({...c}));

    this._adjustDots = false;
    this._removeDots = false;

    this._svg = null;
    this._height = null;
    this._glyphs = null;

    this._svgs = [];
  }

  getWidth(from, to) {
    this._shape();

    if (from === undefined)
      from = this._text.length - 1;
    if (to === undefined)
      to = 0;
    from = this._text[from];
    to = this._text[to];
    return (from.x + from.ax) + (to.x + to.ax);
  }

  set adjustDots(v) {
    if (v != this._adjustDots)
      this._svg = null;
    this._adjustDots = v;
  }

  set removeDots(v) {
    if (v != this._removeDots)
      this._svg = null;
    this._removeDots = v;
  }

  get svg() {
    this._makeSVG();
    return this._svgURL;
  }

  get width() {
    this._shape();
    let c = this._text[0];
    if (c)
      return c.x + c.ax;
    return 0;
  }

  get height() {
    this._shape();
    return this._height;
  }

  featuresOfIndex(index) {
    this._shape();
    let c = this._text[index];
    let p = this._text[index - 1];
    let n = this._text[index + 1];
    if (c && c.baseGlyph)
      return c.baseGlyph.getSubstitutes(n && n.baseGlyph);
  }

  posOfIndex(index) {
    let c = this._text[index];
    if (c)
      return c.x;
    return null;
  }

  indexAtPoint(x) {
    this._shape();

    for (let i = 0; i < this._text.length; i++) {
      let c = this._text[i];
      let left = c.x;
      let right = c.x + c.ax;
      if (x > left && x < right)
        return i;
    }

    if (x < 0)
      return this._text.length;
    return 0;
  }

  getGlyphSVG(glyph) {
    if (this._svgs[glyph] === undefined) {
      let extents = this._font.getGlyphExtents(glyph)
      let ns = "http://www.w3.org/2000/svg";
      let svg = document.createElementNS(ns, "svg");
      svg.setAttribute("xmlns", ns);
      svg.setAttributeNS(ns, "version", '1.1');
      svg.setAttributeNS(ns, "width", extents.width);
      svg.setAttributeNS(ns, "height", this.height);

      let x = -extents.x_bearing, y = this._font.extents.ascender;
      let path = document.createElementNS(ns, "path");
      path.setAttributeNS(ns, "transform", `translate(${x},${y})`);
      path.setAttributeNS(ns, "d", this._font.getGlyphOutline(glyph));
      svg.appendChild(path);

      let blob = new Blob([svg.outerHTML], {type: "image/svg+xml"});
      this._svgs[glyph] = window.URL.createObjectURL(blob);
    }

    return this._svgs[glyph];
  }

  _shape() {
    if (this._glyphs !== null)
      return;

    // Shape once without features to get the base glyphs, which we use to get
    // list of glyph alternates.
    let glyphs = this._buffer.shape(this._font, this._text, false);
    for (const g of glyphs) {
      let c = this._text[g.cl];
      // HACK: this assumes when there are multiple glyphs in a cluster, the
      // last is the base one.
      //assert(!c.baseGlyph);
      c.baseGlyph = g;
    }

    for (let c of this._text) {
      c.x = Number.POSITIVE_INFINITY;
      c.ax = 0;
    }

    // Now do the real shaping with requested features.
    glyphs = this._buffer.shape(this._font, this._text, true);

    let x = 0, y = this._font.extents.ascender;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const g of glyphs) {
      let c = this._text[g.cl];

      if (g.dy > 0 && g.isDot)
        maxY = Math.max(maxY, g.dy);

      g.x = x + g.dx;
      g.y = y - g.dy;
      x += g.ax;
      y -= g.ay;

      c.x = Math.min(c.x, g.x);
      if (g.x + g.ax > c.x + c.ax)
        c.ax += (g.x + g.ax) - (c.x + c.ax)
    }

    let extents = this._font.extents;
    this._glyphs = glyphs;
    this._height = extents.ascender - extents.descender;
    this._dotMaxY = maxY;
  }

  _makeSVG() {
    if (this._svg !== null)
      return;

    this._shape();

    let ns = "http://www.w3.org/2000/svg";
    this._svg = document.createElementNS(ns, "svg");
    this._svg.setAttribute("xmlns", ns);
    this._svg.setAttributeNS(ns, "version", '1.1');
    this._svg.setAttributeNS(ns, "width", this.width || 1);
    this._svg.setAttributeNS(ns, "height", this.height || 1);

    for (const g of this._glyphs) {
      if (this._removeDots && g.isDot)
        continue;

      if (g.layers.length)
        for (const l of g.layers)
          this._svg.appendChild(this._pathElement(l));
      else
        this._svg.appendChild(this._pathElement(g));
    }

    let blob = new Blob([this._svg.outerHTML], {type: "image/svg+xml"});
    this._svgURL = window.URL.createObjectURL(blob);
  }

  _pathElement(g) {
    let x = g.x;
    let y = g.y;
    let color = g.color

    if (this._adjustDots &&
        g.dy > 0 && g.dy < this._dotMaxY && g.isDot)
      y += g.dy - this._dotMaxY;

    if (!g.index && color === undefined)
      color = "red";

    let ns = this._svg.namespaceURI;
    let path = document.createElementNS(ns, "path");
    path.setAttributeNS(ns, "transform", `translate(${x},${y})`);
    if (color !== undefined)
      path.setAttributeNS(ns, "fill", color);
    path.setAttributeNS(ns, "d", g.outline);
    return path;
  }
}

let sample = `[
  {"code": 1582}, {"code": 1591, "features": ["cv01"]}, {"code": 32},
  {"code": 1591, "features": ["cv05"]}, {"code": 1576},
  {"code": 1575, "features": ["cv06"]}, {"code": 1593},
  {"code": 1610, "features": ["cv01"]}, {"code": 32},
  {"code": 1593}, {"code": 1604}, {"code": 1609, "features": ["cv06"]},
  {"code": 32}, {"code": 1602}, {"code": 1608}, {"code": 1575}, {"code": 1593},
  {"code": 1583, "features": ["cv13"]}, {"code": 32}, {"code": 1575},
  {"code": 1604}, {"code": 1582}, {"code": 1591, "features": ["cv01"]},
  {"code": 32}, {"code": 1575}, {"code": 1604},
  {"code": 1603, "features": ["cv16"]}, {"code": 1608}, {"code": 1601},
  {"code": 1610, "features": ["cv05"]}, {"code": 32}, {"code": 1575},
  {"code": 1604}, {"code": 1601}, {"code": 1575},
  {"code": 1591, "features": ["cv01"]}, {"code": 1605},
  {"code": 1610, "features": ["cv04"]}]`;

export class View {
  constructor() {
    this.font = new HarfBuzz.Font(window.devicePixelRatio);
    this.buffer = new HarfBuzz.Buffer();

    this.canvas = document.getElementById("canvas");
    this.backing = document.createElement('canvas');

    this.cursor = 0;
    this.text = null;
    this._layout = null;

    this.canvas.focus();
  }

  update() {
    if (this._layout === null) {
      if (this.text === null)
        this.text = JSON.parse(window.sessionStorage.text || window.localStorage.text || sample);
      else
        window.sessionStorage.text = window.localStorage.text = JSON.stringify(this.text);

      this._layout = new Layout(this.font, this.buffer, this.text);
    }

    let adjustDots = document.getElementById("adjust-dots").checked;
    this._layout.adjustDots = adjustDots;

    let removeDots = document.getElementById("remove-dots").checked;
    this._layout.removeDots = removeDots;

    this._draw();
  }

  _invalidate() {
    this._layout = null;
  }

  _draw() {
    let canvas = this.backing;
    let fontSize = document.getElementById("font-size").value;

    this._scale = fontSize / this.font.upem;

    let margin = 40;
    let width = this._layout.width;
    let height = this._layout.height;

    canvas.width = width * this._scale + margin;
    canvas.height = height * this._scale + margin;
    canvas.style.width = canvas.width / window.devicePixelRatio;
    canvas.style.height = canvas.height / window.devicePixelRatio;

    let ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(margin / 2, margin / 2);
    ctx.scale(this._scale, this._scale);

    // Draw cursor.
    ctx.save();
    ctx.fillStyle = "#0000003f";
    let pos = this._layout.posOfIndex(this.cursor - 1);
    if (pos == null)
      pos = width;
    ctx.fillRect(pos, 0, 100, height);
    ctx.restore();

    let mainCanvas = this.canvas;
    let img = new Image;
    img.onload = function() {
      ctx.drawImage(img, 0, 0);

      let minW = mainCanvas.parentNode.clientWidth * window.devicePixelRatio;
      mainCanvas.width = Math.max(canvas.width, minW);
      mainCanvas.height = canvas.height;
      mainCanvas.style.width = mainCanvas.width / window.devicePixelRatio;
      mainCanvas.style.height = mainCanvas.height / window.devicePixelRatio;

      let mainCtx = mainCanvas.getContext("2d");
      mainCtx.drawImage(canvas, mainCanvas.width - canvas.width, 0);
    }
    img.src = this._layout.svg;

  }

  open(file) {
    let input = document.createElement("input");
    input.type = "file";
    input.onchange = e => {
      let file = e.target.files[0];
      file.text().then(text => {
        this.text = JSON.parse(text);
        this._invalidate();
        this.update();
      });
    }
    input.click();
  }

  save() {
    var link = document.createElement('a');
    let blob = new Blob([JSON.stringify(this.text)], {type: "application/json"});
    link.href = window.URL.createObjectURL(blob);
    link.download = "document.json";
    link.click();
  }

  export() {
    var link = document.createElement('a');
    link.href = this._layout.svg;
    link.download = "document.svg";
    link.click();
  }

  insert(text) {
    let count = 0;
    for (const c of text) {
      this.text.splice(this.cursor + count, 0, {
        code: c.codePointAt(0),
      });
      count++;
    }
    this._invalidate();
    this.moveCursor(count);
  }

  backspace() {
    this.text.splice(this.cursor - 1, 1);
    this._invalidate();
    this.moveCursor(-1);
  }

  moveCursor(movement) {
    let cursor = this.cursor + movement;
    if (cursor >= 0 && cursor <= this.text.length) {
      this.cursor = cursor;
      this.update();
      this._updateAlternates();
    }
  }

  _updateAlternates() {
    let alternates = document.getElementById("alternates");
    alternates.innerHTML = "";

    if (this.cursor <= 0)
      return;

    let c = this.text[this.cursor - 1];
    let features = this._layout.featuresOfIndex(this.cursor - 1) || [];
    for (const [feature, glyph] of features) {
      c.features = c.features || [];

      let button = document.createElement("a");

      button.href = "#";
      if (feature) {
        button.dataset.feature = feature;
        button.title = feature;
      }

      let img = document.createElement('img');
      img.height = 70;
      img.src = this._layout.getGlyphSVG(glyph);
      button.appendChild(img);

      alternates.appendChild(button);
      this._updateFeatureButtons(c.features);

      button.onclick = e => {
        e.preventDefault();

        let chars = [c];
        if (feature == "dlig")
          chars.push(this.text[this.cursor]);

        for (let cc of chars) {
          cc.features = cc.features || [];
          if (cc.features.includes("dlig"))
            cc.features = feature && ["dlig", feature] || ["dlig"];
          else
            cc.features = feature && [feature] || [];
        }

        this._invalidate();
        this.update();
        if (c.features.includes("dlig"))
          this._updateAlternates();
        else
          this._updateFeatureButtons(c.features);
      };
    }
  }

  _updateFeatureButtons(features) {
    let alternates = document.getElementById("alternates");

    let selectbase = false;
    if (features.length == 0)
      selectbase = true;
    else if (features.length == 1 && features[0] == "dlig")
      selectbase = true;

    for (let child of alternates.children)
      if (features.includes(child.dataset.feature) ||
          (selectbase && !child.dataset.feature))
        child.className = "feature selected";
      else
        child.className = "feature";
  }

  setCursorAtPoint(x) {
    if (this._layout === null)
      return;
    let dpr = window.devicePixelRatio;
    let scale = dpr / this._scale;
    let offsetX = (this.canvas.width - this.backing.width) / dpr;
    let ex = (x - this.canvas.offsetLeft - offsetX) * scale;

    let cursor = this._layout.indexAtPoint(ex) + 1;
    this.moveCursor(cursor - this.cursor);
  }
}