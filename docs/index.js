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
};
