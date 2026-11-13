'use strict';

const ctrl = Crosshair.createController(document.getElementById('c'), { size: 800 });

window.api.getConfig().then((c) => ctrl.setConfig(c.crosshair));
window.api.onCrosshair((c) => ctrl.setConfig(c));
window.api.onInput((e) => ctrl.input(e));
