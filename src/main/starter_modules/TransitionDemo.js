/*
@nwWrld name: TransitionDemo
@nwWrld category: Effects
@nwWrld imports: ModuleBase, tween, resolveEasing
*/

class TransitionDemo extends ModuleBase {
  static methods = [
    {
      name: "color",
      executeOnLoad: true,
      options: [
        { name: "color", defaultVal: "#00ff99", type: "text" },
        { name: "duration", defaultVal: 1000, type: "number" },
        { name: "easing", defaultVal: "easeInOutCubic", type: "text" },
      ],
    },
    {
      name: "scale",
      options: [
        { name: "value", defaultVal: 1.5, type: "number" },
        { name: "duration", defaultVal: 600, type: "number" },
        { name: "easing", defaultVal: "easeOutElastic", type: "text" },
      ],
    },
    {
      name: "reset",
      options: [],
    },
  ];

  constructor(container) {
    super(container);
    this.box = document.createElement("div");
    this.box.style.cssText = [
      "width: 50%;",
      "height: 50%;",
      "margin: auto;",
      "position: absolute;",
      "inset: 0;",
      "background: #00ff99;",
      "border-radius: 8px;",
      "transform: scale(1);",
      "transition: none;",
    ].join(" ");
    this.currentScale = 1;
    this.currentColor = { r: 0, g: 255, b: 153 };
    if (this.elem) {
      this.elem.appendChild(this.box);
    }
    this.show();
  }

  color({ color = "#00ff99", duration = 1000, easing = "easeInOutCubic" } = {}) {
    if (!this.box) return;
    const target = this._parseHex(color);
    if (!target) return;

    const result = tween(
      { r: this.currentColor.r, g: this.currentColor.g, b: this.currentColor.b },
      target,
      duration,
      easing,
      (current) => {
        if (!this.box) return;
        const r = Math.round(current.r);
        const g = Math.round(current.g);
        const b = Math.round(current.b);
        this.box.style.background = `rgb(${r},${g},${b})`;
      }
    );
    if (result && result.promise) {
      result.promise.then(() => {
        this.currentColor = target;
      });
    }
  }

  scale({ value = 1.5, duration = 600, easing = "easeOutElastic" } = {}) {
    if (!this.box) return;
    tween(
      { s: this.currentScale },
      { s: value },
      duration,
      easing,
      (current) => {
        if (!this.box) return;
        this.box.style.transform = `scale(${current.s})`;
      }
    );
    this.currentScale = value;
  }

  reset() {
    if (!this.box) return;
    tween(
      { s: this.currentScale },
      { s: 1 },
      400,
      "easeOutCubic",
      (current) => {
        if (!this.box) return;
        this.box.style.transform = `scale(${current.s})`;
      }
    );
    this.currentScale = 1;
  }

  _parseHex(hex) {
    const h = String(hex || "").replace("#", "");
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
      };
    }
    if (h.length === 6) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    return null;
  }

  destroy() {
    if (this.box && this.box.parentNode) {
      this.box.parentNode.removeChild(this.box);
    }
    this.box = null;
    super.destroy();
  }
}

export default TransitionDemo;
