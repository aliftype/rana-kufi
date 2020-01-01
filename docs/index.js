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

import * as TextView from "./TextView.js"

let fontFile = "RanaKufi";

Module["onRuntimeInitialized"] = function() {
  let view = new TextView.View();
  view.update();

  view.canvas.addEventListener('keydown', function(e) {
    if (e.key === "ArrowLeft")
      view.moveCursor(1);
    else if (e.key === "ArrowRight")
      view.moveCursor(-1);
    else if (e.key === "Backspace") {
      e.preventDefault();
      view.backspace();
    }
  });

  view.canvas.addEventListener('click', e => view.setCursorAtPoint(e.clientX));
  view.canvas.addEventListener('keypress', e => view.insert(e.key));

  document.getElementById("open").addEventListener("click", e => view.open(e.value));
  document.getElementById("save").addEventListener("click", e => view.save());
  document.getElementById("export").addEventListener("click", e => view.export());

  document.addEventListener('paste', e => {
    let target = e.explicitOriginalTarget;
    if (target.id === "canvas") {
      let text = (e.clipboardData || window.clipboardData).getData('text');
      view.insert(text);
    }
  });

  [].forEach.call(document.getElementsByClassName("opts"), function(el) {
    el.addEventListener("change", e => view.update());
  });

  let range = document.getElementById("font-size-range");
  let number = document.getElementById("font-size");
  range.addEventListener('input', e => number.value = e.target.value);
  number.addEventListener('input', e => range.value = e.target.value);
};
