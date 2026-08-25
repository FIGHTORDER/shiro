/* Shiro Design System — vendored component library.
 *
 * Extracted from the design bundle, _ds_bundle.js: components only, since the
 * ui_kit screens in that bundle are maintained as real source under
 * src/screens/ instead.
 *
 * DO NOT HAND-EDIT. Re-sync by re-exporting the bundle and re-running the extract.
 * The bundle expects React and lucide as globals, so we bind them first.
 */
import React from "react";
import createIconElement from "lucide/dist/esm/createElement.js";
import { ICONS } from "./icons.js";

window.React = React;

/* Icon rendering.
 *
 * lucide's own createIcons() REPLACES each <i data-lucide> placeholder with a
 * fresh <svg>. React rendered that <i> and still holds a reference to it, so
 * the next time React unmounts the subtree it calls removeChild on a node that
 * is no longer there:
 *
 *   NotFoundError: Failed to execute 'removeChild' on 'Node'
 *
 * React then tears down the whole tree and you get a blank window. It never
 * showed up in the design prototype because nothing there ever unmounted; it
 * appears the moment a list filters rows away.
 *
 * Fix: render the svg INSIDE the placeholder instead of replacing it. React
 * treats the <i> as a childless leaf, so it never reconciles what we put in
 * there, and on unmount it removes the <i> itself - which is still its child.
 */
const ICON_NODES = new Map();

function renderIconsInPlace({ nameAttr = "data-lucide", root } = {}) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  for (const el of scope.querySelectorAll("[" + nameAttr + "]")) {
    const name = el.getAttribute(nameAttr);
    if (!name || el.getAttribute("data-lucide-drawn") === name) continue;

    if (!ICON_NODES.has(name)) ICON_NODES.set(name, ICONS[name] || null);
    const node = ICON_NODES.get(name);
    if (!node) continue;

    const svg = createIconElement(node);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    // Drop the baked-in presentation attribute so stroke-width inherits from
    // the placeholder's style, which is where Icon sets it.
    svg.removeAttribute("stroke-width");
    svg.style.display = "block";

    el.replaceChildren(svg);
    el.setAttribute("data-lucide-drawn", name);
  }
}

/* The bundle's components call window.lucide.createIcons(); nothing else in
   lucide's API is used, so nothing else is provided. */
window.lucide = { createIcons: renderIconsInPlace };


(() => {

const __ds_ns = (window.ShiroDesignSystem_0f4b7d = window.ShiroDesignSystem_0f4b7d || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Lucide via CDN — see readme.md > ICONOGRAPHY for the flagged substitution.
   Stroke is 1.5 at <=16px and 2 above, so icons match hairline weight. */
function Icon({
  name,
  size = 16,
  strokeWidth,
  style,
  className = "",
  ...rest
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const draw = () => window.lucide && window.lucide.createIcons({
      nameAttr: "data-lucide",
      attrs: {},
      root: el.parentNode
    });
    draw();
    const t = setTimeout(draw, 300);
    return () => clearTimeout(t);
  }, [name]);
  return /*#__PURE__*/React.createElement("i", _extends({
    ref: ref,
    "data-lucide": name,
    "aria-hidden": "true",
    className: "shiro-icon " + className,
    style: {
      display: "inline-flex",
      width: size,
      height: size,
      flex: "0 0 auto",
      strokeWidth: strokeWidth != null ? strokeWidth : size <= 16 ? 1.5 : 2,
      color: "currentColor",
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const tones = {
  neutral: {
    background: "var(--w-08)",
    color: "var(--text-body)",
    border: "1px solid transparent"
  },
  solid: {
    background: "var(--surface-inverse)",
    color: "var(--text-inverse)",
    border: "1px solid var(--surface-inverse)"
  },
  outline: {
    background: "transparent",
    color: "var(--text-mid)",
    border: "1px solid var(--w-20)"
  },
  danger: {
    background: "transparent",
    color: "var(--signal-danger)",
    border: "1px solid var(--signal-danger)"
  },
  warn: {
    background: "transparent",
    color: "var(--signal-warn)",
    border: "1px solid rgba(210,168,36,.5)"
  }
};
function Badge({
  children,
  tone = "neutral",
  icon,
  mono,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-2)",
      height: 17,
      padding: "0 var(--sp-3)",
      borderRadius: "var(--radius-sm)",
      font: mono ? "var(--w-medium) var(--size-micro)/1 var(--font-mono)" : "var(--text-label)",
      letterSpacing: mono ? 0 : "var(--track-label-tight)",
      textTransform: mono ? "none" : "uppercase",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
      ...tones[tone],
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14,
    style: {
      width: 12,
      height: 12
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const base = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--sp-3)",
  font: "var(--text-ui-sm)",
  letterSpacing: "var(--track-flat)",
  borderRadius: "var(--radius-none)",
  border: "1px solid transparent",
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "var(--transition-hover)",
  userSelect: "none",
  padding: "0 var(--sp-5)",
  fontFamily: "var(--font-core)"
};
const sizes = {
  sm: {
    height: "var(--control-sm)",
    fontSize: "var(--size-tiny)",
    padding: "0 var(--sp-4)"
  },
  md: {
    height: "var(--control-md)",
    fontSize: "var(--size-small)"
  },
  lg: {
    height: "var(--control-lg)",
    fontSize: "var(--size-base)",
    padding: "0 var(--sp-6)"
  }
};
const variants = {
  primary: {
    background: "var(--surface-inverse)",
    color: "var(--text-inverse)",
    borderColor: "var(--surface-inverse)"
  },
  secondary: {
    background: "transparent",
    color: "var(--text-hi)",
    borderColor: "var(--w-20)"
  },
  quiet: {
    background: "var(--w-06)",
    color: "var(--text-body)",
    borderColor: "transparent"
  },
  ghost: {
    background: "transparent",
    color: "var(--text-mid)",
    borderColor: "transparent"
  },
  danger: {
    background: "transparent",
    color: "var(--signal-danger)",
    borderColor: "var(--signal-danger)"
  }
};
const hovers = {
  primary: {
    background: "var(--ink-100)",
    borderColor: "var(--ink-100)"
  },
  secondary: {
    background: "var(--w-08)",
    borderColor: "var(--w-32)"
  },
  quiet: {
    background: "var(--w-12)",
    color: "var(--text-hi)"
  },
  ghost: {
    background: "var(--w-06)",
    color: "var(--text-hi)"
  },
  danger: {
    background: "rgba(178,18,18,.08)",
    color: "var(--signal-danger)"
  }
};
function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  disabled,
  loading,
  block,
  active,
  style,
  onClick,
  type = "button",
  ...rest
}) {
  const [h, setH] = React.useState(false);
  const [p, setP] = React.useState(false);
  const s = {
    ...base,
    ...sizes[size],
    ...variants[variant],
    ...(h && !disabled ? hovers[variant] : null),
    ...(active ? {
      background: "var(--surface-selected)",
      color: "var(--text-hi)"
    } : null),
    ...(p && !disabled ? {
      transform: "var(--press-shift)"
    } : null),
    ...(disabled || loading ? {
      opacity: 0.38,
      cursor: "not-allowed"
    } : null),
    ...(block ? {
      display: "flex",
      width: "100%"
    } : null),
    ...style
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    style: s,
    disabled: disabled || loading,
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => {
      setH(false);
      setP(false);
    },
    onMouseDown: () => setP(true),
    onMouseUp: () => setP(false)
  }, rest), loading ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 1,
      background: "currentColor",
      opacity: 0.6
    }
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: size === "lg" ? 20 : 16
  }), children, iconRight && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: size === "lg" ? 20 : 16
  })));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "flex-start",
      gap: "var(--sp-4)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.38 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    onChange: onChange,
    disabled: disabled,
    style: {
      position: "absolute",
      opacity: 0,
      width: 0,
      height: 0
    }
  }, rest)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 15,
      height: 15,
      marginTop: 1,
      flex: "0 0 auto",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: checked ? "var(--surface-inverse)" : "var(--surface-base)",
      border: "1px solid " + (checked ? "var(--surface-inverse)" : "var(--w-20)"),
      color: "var(--text-inverse)",
      transition: "var(--transition-hover)"
    }
  }, checked && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 14,
    strokeWidth: 3
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-ui-sm)",
      color: "var(--text-body)"
    }
  }, label), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
      color: "var(--text-low)"
    }
  }, hint)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  active,
  disabled,
  style,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  const box = {
    sm: 24,
    md: 30,
    lg: 38
  }[size];
  const glyph = size === "lg" ? 20 : 16;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      width: box,
      height: box,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: active ? "var(--surface-selected)" : h && !disabled ? "var(--w-08)" : variant === "quiet" ? "var(--w-06)" : "transparent",
      color: active || h ? "var(--text-hi)" : "var(--text-mid)",
      border: variant === "outline" ? "1px solid var(--w-20)" : "1px solid transparent",
      borderRadius: "var(--radius-none)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.38 : 1,
      transition: "var(--transition-hover)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: glyph
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Dialog.jsx
try { (() => {
/* The only floating layer type. Flat 88% black scrim — no blur, deliberately,
   because backdrop-filter degrades under WebKitGTK on Linux. */
function Dialog({
  open,
  title,
  children,
  footer,
  onClose,
  width = 420,
  urgent,
  style
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      zIndex: 60,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--scrim)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    style: {
      width,
      maxWidth: "92%",
      background: "var(--surface-panel)",
      border: "1px solid " + (urgent ? "var(--ink-000)" : "var(--w-20)"),
      boxShadow: "var(--elev-dialog)",
      animation: "shiro-enter var(--dur-base) var(--ease-out)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      height: 30,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 var(--sp-3) 0 var(--sp-5)",
      borderBottom: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-label)",
      letterSpacing: "var(--track-label)",
      textTransform: "uppercase",
      color: "var(--text-mid)"
    }
  }, title), onClose && /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "x",
    label: "Close",
    size: "sm",
    onClick: onClose
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-6)"
    }
  }, children), footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: "var(--sp-4)",
      padding: "var(--sp-5) var(--sp-6)",
      borderTop: "1px solid var(--w-06)"
    }
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  label,
  hint,
  error,
  icon,
  size = "md",
  style,
  wrapStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const h = {
    sm: "var(--control-sm)",
    md: "var(--control-md)",
    lg: "var(--control-lg)"
  }[size];
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-3)",
      ...wrapStyle
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-label)",
      letterSpacing: "var(--track-label)",
      textTransform: "uppercase",
      color: "var(--text-low)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-4)",
      height: h,
      padding: "0 var(--sp-4)",
      background: "var(--surface-base)",
      border: "1px solid " + (error ? "var(--signal-danger)" : focus ? "var(--ink-000)" : "var(--w-12)"),
      transition: "var(--transition-hover)"
    }
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16,
    style: {
      color: "var(--text-low)"
    }
  }), /*#__PURE__*/React.createElement("input", _extends({
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      background: "transparent",
      border: 0,
      outline: "none",
      color: "var(--text-hi)",
      font: "var(--text-ui)",
      fontFamily: "var(--font-core)",
      ...style
    }
  }, rest))), (error || hint) && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
      color: error ? "var(--signal-danger)" : "var(--text-low)"
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/Meter.jsx
try { (() => {
/* Progress toward next rank / next level, download progress, queue fill.
   Greyscale fill; indeterminate uses the GPU-composited shiro-sweep loop. */
function Meter({
  value = 0,
  max = 100,
  label,
  right,
  indeterminate,
  height = 3,
  style
}) {
  const pct = Math.max(0, Math.min(100, value / (max || 1) * 100));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-3)",
      minWidth: 0,
      ...style
    }
  }, (label || right) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-label)",
      letterSpacing: "var(--track-label)",
      textTransform: "uppercase",
      color: "var(--text-low)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)",
      color: "var(--text-mid)",
      fontVariantNumeric: "tabular-nums"
    }
  }, right)), /*#__PURE__*/React.createElement("div", {
    style: {
      height,
      background: "var(--w-08)",
      overflow: "hidden"
    }
  }, indeterminate ? /*#__PURE__*/React.createElement("div", {
    style: {
      height,
      width: "40%",
      background: "var(--ink-000)",
      animation: "shiro-sweep 1.4s var(--ease-linear) infinite"
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      height,
      width: pct + "%",
      background: "var(--surface-inverse)",
      transition: "width var(--dur-slow) var(--ease-out)"
    }
  })));
}
Object.assign(__ds_scope, { Meter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Meter.jsx", error: String((e && e.message) || e) }); }

// components/core/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* The only container in Shiro. Panels tile edge-to-edge and are separated by a
   hairline, never by a gap. There are no floating cards in this system. */
function Panel({
  label,
  actions,
  children,
  scroll,
  flush,
  style,
  bodyStyle,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      minHeight: 0,
      background: "var(--surface-panel)",
      border: "1px solid var(--w-12)",
      borderRadius: "var(--radius-none)",
      ...style
    }
  }, rest), (label || actions) && /*#__PURE__*/React.createElement("header", {
    style: {
      height: 26,
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--sp-4)",
      padding: "0 var(--sp-4)",
      borderBottom: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-label)",
      letterSpacing: "var(--track-label)",
      textTransform: "uppercase",
      color: "var(--text-low)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-2)"
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      padding: flush ? 0 : "var(--sp-5)",
      overflowY: scroll ? "auto" : "visible",
      ...bodyStyle
    }
  }, children));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Panel.jsx", error: String((e && e.message) || e) }); }

// components/core/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  label,
  options = [],
  value,
  onChange,
  size = "md",
  style,
  wrapStyle,
  ...rest
}) {
  const h = {
    sm: "var(--control-sm)",
    md: "var(--control-md)",
    lg: "var(--control-lg)"
  }[size];
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-3)",
      ...wrapStyle
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-label)",
      letterSpacing: "var(--track-label)",
      textTransform: "uppercase",
      color: "var(--text-low)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      height: h,
      background: "var(--surface-base)",
      border: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    onChange: onChange,
    style: {
      appearance: "none",
      flex: 1,
      height: "100%",
      background: "transparent",
      border: 0,
      outline: "none",
      color: "var(--text-hi)",
      font: "var(--text-ui-sm)",
      fontFamily: "var(--font-core)",
      padding: "0 28px 0 var(--sp-4)",
      ...style
    }
  }, rest), options.map(o => typeof o === "string" ? /*#__PURE__*/React.createElement("option", {
    key: o,
    value: o,
    style: {
      background: "var(--white)"
    }
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value,
    style: {
      background: "var(--white)"
    }
  }, o.label))), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 14,
    style: {
      position: "absolute",
      right: 8,
      color: "var(--text-low)",
      pointerEvents: "none"
    }
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Select.jsx", error: String((e && e.message) || e) }); }

// components/core/Switch.jsx
try { (() => {
function Switch({
  checked,
  onChange,
  label,
  disabled,
  style
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-4)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.38 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: 30,
      height: 16,
      padding: 2,
      display: "inline-flex",
      alignItems: "center",
      background: checked ? "var(--surface-inverse)" : "var(--surface-base)",
      border: "1px solid " + (checked ? "var(--surface-inverse)" : "var(--w-20)"),
      transition: "var(--transition-hover)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      background: checked ? "var(--text-inverse)" : "var(--ash-400)",
      transform: checked ? "translateX(14px)" : "none",
      transition: "transform var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out)"
    }
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-ui-sm)",
      color: "var(--text-body)"
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Switch.jsx", error: String((e && e.message) || e) }); }

// components/core/Tabs.jsx
try { (() => {
function Tabs({
  items = [],
  value,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: "flex",
      alignItems: "stretch",
      borderBottom: "1px solid var(--w-12)",
      ...style
    }
  }, items.map(it => {
    const active = it.id === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      role: "tab",
      "aria-selected": active,
      onClick: () => onChange && onChange(it.id),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: 30,
        padding: "0 var(--sp-5)",
        background: active ? "var(--w-06)" : "transparent",
        border: 0,
        borderBottom: "2px solid " + (active ? "var(--ink-000)" : "transparent"),
        color: active ? "var(--text-hi)" : "var(--text-mid)",
        cursor: "pointer",
        font: "var(--text-ui-sm)",
        fontFamily: "var(--font-core)",
        transition: "var(--transition-hover)",
        position: "relative"
      }
    }, it.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon,
      size: 14
    }), it.label, it.mention ? /*#__PURE__*/React.createElement("span", {
      style: {
        width: 6,
        height: 6,
        background: "var(--signal-danger)",
        borderRadius: "var(--radius-pill)"
      }
    }) : it.unread ? /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)",
        color: "var(--text-low)",
        fontVariantNumeric: "tabular-nums"
      }
    }, it.unread) : null, it.onClose && /*#__PURE__*/React.createElement("span", {
      onClick: e => {
        e.stopPropagation();
        it.onClose();
      },
      style: {
        color: "var(--text-faint)",
        font: "var(--w-regular) 13px/1 var(--font-core)"
      }
    }, "\xD7"));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* A removable, low-weight token: mod options, filters, awards. */
function Tag({
  children,
  onRemove,
  value,
  style,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", _extends({
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      height: 20,
      padding: "0 var(--sp-3)",
      background: "var(--w-06)",
      border: "1px solid var(--w-06)",
      font: "var(--w-medium) var(--size-tiny)/1 var(--font-core)",
      color: "var(--text-body)",
      transition: "var(--transition-hover)",
      ...style
    }
  }, rest), children, value != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
      color: "var(--text-hi)",
      fontVariantNumeric: "tabular-nums"
    }
  }, value), onRemove && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onRemove,
    "aria-label": "Remove",
    style: {
      background: "none",
      border: 0,
      padding: 0,
      cursor: "pointer",
      lineHeight: 1,
      color: h ? "var(--text-hi)" : "var(--text-low)",
      font: "var(--w-regular) 13px/1 var(--font-core)"
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/core/Tooltip.jsx
try { (() => {
function Tooltip({
  label,
  children,
  side = "top",
  style
}) {
  const [open, setOpen] = React.useState(false);
  const pos = side === "top" ? {
    bottom: "calc(100% + 6px)",
    left: "50%",
    transform: "translateX(-50%)"
  } : side === "bottom" ? {
    top: "calc(100% + 6px)",
    left: "50%",
    transform: "translateX(-50%)"
  } : side === "left" ? {
    right: "calc(100% + 6px)",
    top: "50%",
    transform: "translateY(-50%)"
  } : {
    left: "calc(100% + 6px)",
    top: "50%",
    transform: "translateY(-50%)"
  };
  return /*#__PURE__*/React.createElement("span", {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    style: {
      position: "relative",
      display: "inline-flex",
      ...style
    }
  }, children, open && label && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: "absolute",
      zIndex: 40,
      ...pos,
      background: "var(--surface-inverse)",
      border: "1px solid var(--surface-inverse)",
      boxShadow: "var(--elev-menu)",
      padding: "var(--sp-2) var(--sp-4)",
      whiteSpace: "nowrap",
      font: "var(--w-medium) var(--size-tiny)/1.3 var(--font-core)",
      color: "var(--text-inverse)",
      animation: "shiro-enter var(--dur-fast) var(--ease-out)"
    }
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/lobby/EmptyState.jsx
try { (() => {
/* Empty states name the situation and offer the useful move. No apology,
   no mascot, no illustration. */
function EmptyState({
  icon,
  title,
  body,
  action,
  numeral,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "var(--sp-5)",
      padding: "var(--sp-10) var(--sp-6)",
      textAlign: "center",
      ...style
    }
  }, numeral != null ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) var(--size-3xl)/1 var(--font-core)",
      letterSpacing: "var(--track-display)",
      color: "var(--text-faint)",
      fontVariantNumeric: "tabular-nums"
    }
  }, numeral) : icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 24,
    style: {
      color: "var(--text-faint)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-3)",
      maxWidth: "44ch"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-heading)",
      color: "var(--text-body)"
    }
  }, title), body && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-small)/1.5 var(--font-core)",
      color: "var(--text-low)"
    }
  }, body)), action);
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lobby/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/lobby/FactionMark.jsx
try { (() => {
const FACTIONS = {
  machines: {
    name: "Free Machines",
    short: "Machines",
    color: "var(--faction-machines)"
  },
  hegemony: {
    name: "Synthetic Hegemony",
    short: "Hegemony",
    color: "var(--faction-hegemony)"
  },
  rising: {
    name: "Humanity Rising",
    short: "Rising",
    color: "var(--faction-rising)"
  }
};

/* The only chroma in the product. Marks at small size, never a surface. */
function FactionMark({
  faction,
  variant = "bar",
  showName,
  style
}) {
  const fac = FACTIONS[faction];
  if (!fac) return null;
  if (variant === "dot") return /*#__PURE__*/React.createElement("span", {
    title: fac.name,
    style: {
      width: 8,
      height: 8,
      flex: "0 0 auto",
      borderRadius: "var(--radius-pill)",
      background: fac.color,
      display: "inline-block",
      ...style
    }
  });
  if (variant === "label") return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      height: 11,
      background: fac.color
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-label)",
      letterSpacing: "var(--track-label-tight)",
      textTransform: "uppercase",
      color: "var(--text-mid)"
    }
  }, showName ? fac.name : fac.short));
  return /*#__PURE__*/React.createElement("span", {
    title: fac.name,
    style: {
      width: 3,
      alignSelf: "stretch",
      minHeight: 14,
      background: fac.color,
      flex: "0 0 auto",
      ...style
    }
  });
}
Object.assign(__ds_scope, { FACTIONS, FactionMark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lobby/FactionMark.jsx", error: String((e && e.message) || e) }); }

// components/lobby/MapImage.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const BASE = "https://zero-k.info/Resources/";

/* Map imagery is the only imagery in Shiro. 404 is a designed state, not a
   broken image — new maps genuinely 404. */
function MapImage({
  map = "",
  kind = "thumbnail",
  ratio,
  caption,
  saturate = 0.9,
  link,
  /* VENDOR PATCH: zero-k.info addresses a map's page by numeric ResourceID.
     Supplied by the caller from the site's catalogue; absent for a map the
     catalogue does not list, which falls back to a search. */
  resourceId,
  style
}) {
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const imgRef = React.useRef(null);
  /* VENDOR PATCH (see README > Known issues): zero-k.info stores map assets
     with underscores, but the lobby server sends names with spaces, so an
     unnormalized name 404s for most maps. Display text keeps the spaces. */
  const src = BASE + encodeURIComponent(String(map).replace(/ /g, "_")) + "." + kind + ".jpg";
  /* VENDOR PATCH: settle the fade from the element, not only from the event.

     The image is drawn at `opacity: 0` until `load` fires. When the browser
     already has the picture, it can finish before that handler is listening,
     the event goes to nobody, and the gate never opens - a fully decoded
     minimap sitting invisible on the black ground below it.

     It showed up as "map images are black in battle rooms and fine
     everywhere else", which is the same fact in disguise: the room is the
     one place you always arrive having just seen that map in the list, so
     the room is the one place the picture is always already in hand. Read
     off a live room: `complete: true`, `naturalWidth: 1024`, `opacity: 0`.

     An element that is `complete` has the answer without being asked, so ask
     it. `naturalWidth` separates a picture from a 404, which is the same
     thing `onError` would have said. This runs before paint, so a cached
     image is opaque on its first frame rather than fading in from nothing.

     Replaces an effect on `[map]` that only cleared the two flags. Keying on
     `src` instead is what makes it safe to set them here as well: names that
     differ only in their spaces - the server sends both - address the same
     picture, and used to reset a fade that then had no event left to reopen
     it. */
  React.useLayoutEffect(() => {
    /* The element is always mounted, so this always has one to ask. It used to
       be swapped out for the placeholder on failure, which meant the ref was
       null exactly when a new `src` needed to clear the failure - so one 404
       stuck, and every map picked afterwards showed the placeholder. */
    const el = imgRef.current;
    if (!el) return undefined;
    const settle = () => {
      setLoaded(el.naturalWidth > 0);
      setFailed(el.naturalWidth === 0);
    };
    if (el.complete) { settle(); return undefined; }
    setLoaded(false);
    setFailed(false);
    el.addEventListener("load", settle);
    el.addEventListener("error", settle);
    return () => {
      el.removeEventListener("load", settle);
      el.removeEventListener("error", settle);
    };
  }, [src]);
  const m = map.match(/^(.*?)((?:_v?\d[\d.]*)?)$/) || [];
  /* The minimap is a door: on zero-k.info the map has a real detail page with
     heightmap, size and win statistics, which is exactly what a room arguing
     about balance wants. */
  const Root = link ? "a" : "div";
  const rootProps = link ? {
    /* VENDOR PATCH (see README > Known issues): /Maps/Detail?name= is ignored
       by zero-k.info - a real map, a nonsense one and an empty one all return
       a byte-identical generic page, which is why these links appeared to go
       "only to the maps page". The detail page is addressed by numeric
       ResourceID, which the site's own catalogue supplies (see
       src/net/zkcatalogue.ts). Without an id - an unlisted or brand new map -
       ?search= is relevance-ordered and puts the right map first. */
    href: resourceId ? "https://zero-k.info/Maps/Detail/" + resourceId : "https://zero-k.info/Maps?search=" + encodeURIComponent(String(map).replace(/_/g, " ")),
    target: "_blank",
    rel: "noreferrer",
    title: "Open " + map + " on zero-k.info"
  } : {};
  return /*#__PURE__*/React.createElement(Root, _extends({}, rootProps, {
    style: {
      position: "relative",
      display: "block",
      overflow: "hidden",
      background: "var(--ink-000)",
      textDecoration: "none",
      aspectRatio: ratio,
      ...style
    }
  }), /*#__PURE__*/React.createElement("img", {
    ref: imgRef,
    src: src,
    alt: "",
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
      filter: "saturate(" + saturate + ")",
      opacity: loaded ? 1 : 0,
      transition: "opacity var(--dur-base) var(--ease-out)"
    }
  }), failed && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: "var(--sp-4)",
      background: "var(--surface-sunken)",
      border: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-label)",
      letterSpacing: "var(--track-label)",
      textTransform: "uppercase",
      color: "var(--text-low)",
      wordBreak: "break-word"
    }
  }, map)), caption && !failed && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "var(--protect-bottom)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: "var(--sp-4)",
      right: "var(--sp-4)",
      bottom: "var(--sp-3)",
      font: "var(--w-semibold) var(--size-tiny)/1.2 var(--font-core)",
      color: "var(--white)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, m[1], /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--fff-56)"
    }
  }, m[2]))), link && !failed && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: "var(--sp-4)",
      top: "var(--sp-3)",
      font: "var(--text-label)",
      letterSpacing: "var(--track-label)",
      textTransform: "uppercase",
      color: "var(--fff-72)"
    }
  }, "ZERO-K.INFO \u2197"));
}
Object.assign(__ds_scope, { MapImage });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lobby/MapImage.jsx", error: String((e && e.message) || e) }); }

// components/lobby/BattleRow.jsx
try { (() => {
const fmt = s => {
  if (s == null) return "";
  const m = Math.floor(s / 60),
    h = Math.floor(m / 60);
  return h ? h + ":" + String(m % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0") : m + ":" + String(s % 60).padStart(2, "0");
};

/* The highest-traffic surface in the app: 56px, map thumbnail left, title and
   host stacked, then fixed metadata columns that align down the whole list. */
function BattleRow({
  title,
  map,
  founder,
  players = 0,
  maxPlayers = 0,
  spectators = 0,
  mode,
  locked,
  running,
  runningSince,
  matchmaker,
  selected,
  onClick,
  onJoin,
  style
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-5)",
      height: "var(--row-battle)",
      padding: "0 var(--sp-5) 0 0",
      cursor: "pointer",
      minWidth: 0,
      background: selected ? "var(--surface-selected)" : h ? "var(--surface-hover)" : "transparent",
      boxShadow: "var(--rule-inset)",
      transition: "var(--transition-hover)",
      ...style
    }
  }, selected && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: 2,
      background: "var(--ink-000)",
      zIndex: 1
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.MapImage, {
    map: map,
    style: {
      width: 96,
      height: "100%",
      flex: "0 0 auto"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      minWidth: 0
    }
  }, locked && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "lock",
    size: 14,
    style: {
      width: 12,
      height: 12,
      color: "var(--text-low)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-semibold) var(--size-base)/1.2 var(--font-core)",
      color: h || selected ? "var(--text-hi)" : "var(--text-body)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      minWidth: 0
    }
  }, title), matchmaker && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "solid"
  }, "MM"), running && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "danger",
    mono: true
  }, fmt(runningSince))), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1 var(--font-core)",
      color: "var(--text-low)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, founder)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 88,
      font: "var(--text-label)",
      letterSpacing: "var(--track-label-tight)",
      textTransform: "uppercase",
      color: "var(--text-mid)",
      textAlign: "right",
      flex: "0 0 auto"
    }
  }, mode), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 62,
      textAlign: "right",
      flex: "0 0 auto",
      font: "var(--w-medium) var(--size-small)/1 var(--font-mono)",
      fontVariantNumeric: "tabular-nums",
      color: players >= maxPlayers ? "var(--text-low)" : "var(--text-hi)"
    }
  }, players, "/", maxPlayers), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 44,
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 4,
      flex: "0 0 auto",
      color: "var(--text-low)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "eye",
    size: 14,
    style: {
      width: 12,
      height: 12
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
      fontVariantNumeric: "tabular-nums"
    }
  }, spectators)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 74,
      flex: "0 0 auto",
      display: "flex",
      justifyContent: "flex-end"
    }
  }, (h || selected) && onJoin && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: e => {
      e.stopPropagation();
      onJoin();
    },
    style: {
      height: 24,
      padding: "0 var(--sp-4)",
      background: "var(--surface-inverse)",
      color: "var(--text-inverse)",
      border: 0,
      cursor: "pointer",
      font: "var(--w-semibold) var(--size-tiny)/1 var(--font-core)"
    }
  }, running ? "Watch" : "Join")));
}
Object.assign(__ds_scope, { BattleRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lobby/BattleRow.jsx", error: String((e && e.message) || e) }); }

// components/lobby/PresenceDot.jsx
try { (() => {
const colors = {
  online: "var(--presence-online)",
  away: "var(--presence-away)",
  room: "var(--presence-room)",
  ingame: "var(--presence-ingame)",
  offline: "var(--presence-offline)"
};
const labels = {
  online: "Online",
  away: "Away",
  room: "In a battle room",
  ingame: "In game",
  offline: "Offline"
};

/* The protocol gives four meaningful presence states plus flags. Shape carries
   the state as well as colour: filled = active, ring = away, square = bot. */
function PresenceDot({
  state = "online",
  bot,
  size = 8,
  title,
  style
}) {
  const ring = state === "away" || state === "offline";
  return /*#__PURE__*/React.createElement("span", {
    title: title || labels[state],
    style: {
      width: size,
      height: size,
      flex: "0 0 auto",
      borderRadius: bot ? "var(--radius-none)" : "var(--radius-pill)",
      background: ring ? "transparent" : colors[state],
      border: ring ? "1px solid " + colors[state] : "1px solid transparent",
      boxSizing: "border-box",
      display: "inline-block",
      ...style
    }
  });
}
Object.assign(__ds_scope, { PresenceDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lobby/PresenceDot.jsx", error: String((e && e.message) || e) }); }

// components/lobby/RatingDelta.jsx
try { (() => {
/* Rating changes always carry their sign. Greyscale: gain is white, loss is mid-grey.
   Never green/red — the debriefing already states victory or defeat in words. */
function RatingDelta({
  value = 0,
  size = "md",
  showZero,
  style
}) {
  if (!value && !showZero) return null;
  const sign = value > 0 ? "+" : value < 0 ? "\u2212" : "";
  const fonts = {
    sm: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
    md: "var(--w-bold) var(--size-mid)/1 var(--font-mono)",
    lg: "var(--w-bold) var(--size-2xl)/1 var(--font-mono)"
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      font: fonts[size],
      fontVariantNumeric: "tabular-nums",
      color: value > 0 ? "var(--text-hi)" : value < 0 ? "var(--text-mid)" : "var(--text-low)",
      ...style
    }
  }, sign, Math.abs(value));
}
Object.assign(__ds_scope, { RatingDelta });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lobby/RatingDelta.jsx", error: String((e && e.message) || e) }); }

// components/lobby/UserChip.jsx
try { (() => {
/* Inline identity: presence + clan + name + flags. Used in chat, user lists,
   spectator strips and tooltips. Name truncates; nothing else does. */
function UserChip({
  name,
  clan,
  country,
  faction,
  presence = "online",
  bot,
  admin,
  level,
  elo,
  /* VENDOR PATCH: the colour Zero-K's rank icon carries for this player's
     rating, so the number agrees with the badge the official client shows.
     Computed in src/net/ranks.ts; absent when we have no rating. */
  eloTint,
  size = "md",
  muted,
  style
}) {
  const fs = size === "sm" ? "var(--size-tiny)" : "var(--size-small)";
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.PresenceDot, {
    state: presence,
    bot: bot,
    size: size === "sm" ? 6 : 8
  }), faction && /*#__PURE__*/React.createElement(__ds_scope.FactionMark, {
    faction: faction,
    variant: "dot",
    style: {
      width: 6,
      height: 6
    }
  }), country && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)",
      color: "var(--text-faint)",
      letterSpacing: ".04em"
    }
  }, country), clan && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) " + fs + "/1 var(--font-core)",
      color: "var(--text-low)"
    }
  }, "[", clan, "]"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) " + fs + "/1.2 var(--font-core)",
      color: muted ? "var(--text-low)" : "var(--text-hi)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      minWidth: 0
    }
  }, name), admin && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "shield",
    size: 14,
    style: {
      width: 12,
      height: 12,
      color: "var(--text-low)"
    }
  }), level != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)",
      color: "var(--text-faint)",
      fontVariantNumeric: "tabular-nums"
    }
  }, "L", level), elo != null && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
      color: eloTint || "var(--text-mid)",   // VENDOR PATCH: see eloTint above
      fontVariantNumeric: "tabular-nums"
    }
  }, elo));
}
Object.assign(__ds_scope, { UserChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lobby/UserChip.jsx", error: String((e && e.message) || e) }); }

// components/lobby/ChatLine.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Chat is user content: it wraps, it is never truncated, and it is never re-cased. */
function ChatLine({
  user,
  text,
  time,
  emote,
  ring,
  system,
  style
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: "flex",
      gap: "var(--sp-4)",
      padding: "3px var(--sp-5)",
      minWidth: 0,
      background: ring ? "rgba(178,18,18,.06)" : h ? "var(--surface-hover)" : "transparent",
      borderLeft: ring ? "2px solid var(--signal-danger)" : "2px solid transparent",
      transition: "var(--transition-hover)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "0 0 auto",
      width: 38,
      font: "var(--w-regular) var(--size-micro)/18px var(--font-mono)",
      color: h ? "var(--text-low)" : "transparent",
      fontVariantNumeric: "tabular-nums"
    }
  }, time), system ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-small)/18px var(--font-core)",
      color: "var(--text-low)",
      fontStyle: "normal"
    }
  }, text) : emote ? /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-small)/18px var(--font-core)",
      color: "var(--text-mid)",
      minWidth: 0,
      overflowWrap: "anywhere"
    }
  }, user && user.name, " ", text) : /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      font: "var(--w-regular) var(--size-small)/18px var(--font-core)",
      color: "var(--text-body)",
      overflowWrap: "anywhere",
      textWrap: "pretty"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.UserChip, _extends({}, user, {
    size: "sm",
    style: {
      marginRight: "var(--sp-3)",
      verticalAlign: "baseline"
    }
  })), text));
}
Object.assign(__ds_scope, { ChatLine });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lobby/ChatLine.jsx", error: String((e && e.message) || e) }); }

// components/lobby/PlayerRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SYNC = {
  ok: null,
  downloading: "download",
  missing: "x"
};

/* A 32px row in a team column or user list. Sync status, host crown, party
   membership and spectator state all read from one line. */
function PlayerRow({
  user = {},
  sync = "ok",
  host,
  party,
  spectator,
  selected,
  right,
  onClick,
  style
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-4)",
      height: "var(--row-default)",
      padding: "0 var(--sp-4)",
      minWidth: 0,
      cursor: onClick ? "pointer" : "default",
      background: selected ? "var(--surface-selected)" : h ? "var(--surface-hover)" : "transparent",
      boxShadow: "var(--rule-inset)",
      transition: "var(--transition-hover)",
      ...style
    }
  }, selected && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: 2,
      background: "var(--ink-000)"
    }
  }), party != null && /*#__PURE__*/React.createElement("span", {
    title: "Party " + party,
    style: {
      width: 2,
      alignSelf: "stretch",
      margin: "6px 0",
      background: "var(--w-32)"
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.UserChip, _extends({}, user, {
    muted: spectator,
    style: {
      flex: 1,
      minWidth: 0
    }
  })), host && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "crown",
    size: 14,
    style: {
      width: 13,
      height: 13,
      color: "var(--text-mid)"
    }
  }), SYNC[sync] && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: SYNC[sync],
    size: 14,
    style: {
      width: 13,
      height: 13,
      color: sync === "missing" ? "var(--signal-danger)" : "var(--text-low)"
    }
  }), right);
}
Object.assign(__ds_scope, { PlayerRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lobby/PlayerRow.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Meter = __ds_scope.Meter;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.BattleRow = __ds_scope.BattleRow;

__ds_ns.ChatLine = __ds_scope.ChatLine;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.FACTIONS = __ds_scope.FACTIONS;

__ds_ns.FactionMark = __ds_scope.FactionMark;

__ds_ns.MapImage = __ds_scope.MapImage;

__ds_ns.PlayerRow = __ds_scope.PlayerRow;

__ds_ns.PresenceDot = __ds_scope.PresenceDot;

__ds_ns.RatingDelta = __ds_scope.RatingDelta;

__ds_ns.UserChip = __ds_scope.UserChip;

})();

const __ds = window.ShiroDesignSystem_0f4b7d;
export const {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Icon,
  IconButton,
  Input,
  Meter,
  Panel,
  Select,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  BattleRow,
  ChatLine,
  EmptyState,
  FACTIONS,
  FactionMark,
  MapImage,
  PlayerRow,
  PresenceDot,
  RatingDelta,
  UserChip,
} = __ds;
export default __ds;
