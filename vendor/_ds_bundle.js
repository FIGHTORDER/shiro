/* @ds-bundle: {"format":4,"namespace":"ShiroDesignSystem_0f4b7d","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Checkbox","sourcePath":"components/core/Checkbox.jsx"},{"name":"Dialog","sourcePath":"components/core/Dialog.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Meter","sourcePath":"components/core/Meter.jsx"},{"name":"Panel","sourcePath":"components/core/Panel.jsx"},{"name":"Select","sourcePath":"components/core/Select.jsx"},{"name":"Switch","sourcePath":"components/core/Switch.jsx"},{"name":"Tabs","sourcePath":"components/core/Tabs.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"Tooltip","sourcePath":"components/core/Tooltip.jsx"},{"name":"BattleRow","sourcePath":"components/lobby/BattleRow.jsx"},{"name":"ChatLine","sourcePath":"components/lobby/ChatLine.jsx"},{"name":"EmptyState","sourcePath":"components/lobby/EmptyState.jsx"},{"name":"FACTIONS","sourcePath":"components/lobby/FactionMark.jsx"},{"name":"FactionMark","sourcePath":"components/lobby/FactionMark.jsx"},{"name":"MapImage","sourcePath":"components/lobby/MapImage.jsx"},{"name":"PlayerRow","sourcePath":"components/lobby/PlayerRow.jsx"},{"name":"PresenceDot","sourcePath":"components/lobby/PresenceDot.jsx"},{"name":"RatingDelta","sourcePath":"components/lobby/RatingDelta.jsx"},{"name":"UserChip","sourcePath":"components/lobby/UserChip.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"d3c78d532611","components/core/Button.jsx":"f9a10915a7fe","components/core/Checkbox.jsx":"351f7d3079a0","components/core/Dialog.jsx":"80f6f15b4bf6","components/core/Icon.jsx":"ca0c63e42ff1","components/core/IconButton.jsx":"48475a8b277e","components/core/Input.jsx":"566ef616c073","components/core/Meter.jsx":"7b0beb24baa1","components/core/Panel.jsx":"d4e7caa5e0d0","components/core/Select.jsx":"e824a48de2e9","components/core/Switch.jsx":"298164689922","components/core/Tabs.jsx":"82bcc92b3304","components/core/Tag.jsx":"9e4f42547a47","components/core/Tooltip.jsx":"0473e060b5d7","components/lobby/BattleRow.jsx":"790776e1242d","components/lobby/ChatLine.jsx":"0304a6eaac0d","components/lobby/EmptyState.jsx":"84ff8073a49d","components/lobby/FactionMark.jsx":"f535627fbf07","components/lobby/MapImage.jsx":"60d03c352282","components/lobby/PlayerRow.jsx":"b2f2c1b6f6c0","components/lobby/PresenceDot.jsx":"620fa8aceae2","components/lobby/RatingDelta.jsx":"3e7f99d6dcd2","components/lobby/UserChip.jsx":"cdca08692da2","ui_kits/lobby/App.jsx":"12a75ed38cf4","ui_kits/lobby/AppShell.jsx":"7f9ad84d041b","ui_kits/lobby/BattleListScreen.jsx":"2799cb49e0bb","ui_kits/lobby/BattleRoomScreen.jsx":"7dff0e7860f7","ui_kits/lobby/ChatScreen.jsx":"62625cfb8ba6","ui_kits/lobby/DebriefingScreen.jsx":"e6dfa00b26e3","ui_kits/lobby/FriendsScreen.jsx":"58c00cc17ded","ui_kits/lobby/LoginScreen.jsx":"3f4ab8a7e5fc","ui_kits/lobby/QueueScreen.jsx":"99bedf953419","ui_kits/lobby/data.js":"9380c7a39035"},"inlinedExternals":[],"unexposedExports":[]} */

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
  style
}) {
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [map]);
  const src = BASE + encodeURIComponent(map) + "." + kind + ".jpg";
  const m = map.match(/^(.*?)((?:_v?\d[\d.]*)?)$/) || [];
  /* The minimap is a door: on zero-k.info the map has a real detail page with
     heightmap, size and win statistics, which is exactly what a room arguing
     about balance wants. */
  const Root = link ? "a" : "div";
  const rootProps = link ? {
    href: "https://zero-k.info/Maps/Detail?name=" + encodeURIComponent(map),
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
  }), failed ? /*#__PURE__*/React.createElement("div", {
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
  }, map)) : /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: "",
    onError: () => setFailed(true),
    onLoad: () => setLoaded(true),
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
      filter: "saturate(" + saturate + ")",
      opacity: loaded ? 1 : 0,
      transition: "opacity var(--dur-base) var(--ease-out)"
    }
  }), caption && !failed && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
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
      color: "var(--text-mid)",
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

// ui_kits/lobby/App.jsx
try { (() => {
const {
  Dialog,
  Button,
  Meter
} = window.ShiroDesignSystem_0f4b7d;
const D = window.SHIRO_DATA;

/* Click-through: login → battle list → battle room → (launch) → debriefing.
   The ready-check is a shell-level overlay because it interrupts any screen. */
function App() {
  const [loggedIn, setLoggedIn] = React.useState(false);
  const [view, setView] = React.useState("battles");
  const [room, setRoom] = React.useState(null);
  const [empty, setEmpty] = React.useState(false);
  const [queued, setQueued] = React.useState(false);
  const [check, setCheck] = React.useState(0);
  const [launching, setLaunching] = React.useState(false);
  React.useEffect(() => {
    if (!check) return;
    const t = setInterval(() => setCheck(c => c > 1 ? c - 1 : 0), 1000);
    return () => clearInterval(t);
  }, [check]);
  if (!loggedIn) {
    return /*#__PURE__*/React.createElement(AppShell, {
      view: view,
      onView: setView,
      connection: "online",
      users: D.welcome.UserCount,
      engine: D.welcome.Engine,
      game: D.welcome.Game
    }, /*#__PURE__*/React.createElement(LoginScreen, {
      onLogin: () => setLoggedIn(true)
    }));
  }
  let body;
  if (room) body = /*#__PURE__*/React.createElement(BattleRoomScreen, {
    room: D.room,
    onLeave: () => setRoom(null),
    onStart: () => {
      setLaunching(true);
      setTimeout(() => {
        setLaunching(false);
        setRoom(null);
        setView("debrief");
      }, 1600);
    }
  });else if (view === "battles") body = /*#__PURE__*/React.createElement(BattleListScreen, {
    battles: D.battles,
    empty: empty,
    onToggleEmpty: e => setEmpty(e.target.checked),
    onJoin: b => setRoom(b)
  });else if (view === "chat") body = /*#__PURE__*/React.createElement(ChatScreen, {
    channels: D.channels,
    users: D.channelUsers,
    messages: D.channelChat
  });else if (view === "queue") body = /*#__PURE__*/React.createElement(QueueScreen, {
    queued: queued,
    onQueue: setQueued,
    onFake: () => setCheck(9)
  });else if (view === "friends") body = /*#__PURE__*/React.createElement(FriendsScreen, {
    users: D.channelUsers
  });else body = /*#__PURE__*/React.createElement(DebriefingScreen, {
    d: D.debrief,
    onBack: () => setView("battles")
  });
  const overlay = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Dialog, {
    open: check > 0,
    title: "Ready check",
    urgent: true,
    width: 380,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: () => {
        setCheck(0);
        setQueued(false);
      }
    }, "Decline"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      onClick: () => {
        setCheck(0);
        setQueued(false);
        setRoom(D.room);
      }
    }, "Ready"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-title)",
      color: "var(--text-hi)"
    }
  }, "Match found. Ready?"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-num-lg)",
      color: "var(--text-hi)",
      fontVariantNumeric: "tabular-nums"
    }
  }, check, "s")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Meter, {
    value: check,
    max: 9,
    height: 2
  }))), /*#__PURE__*/React.createElement(Dialog, {
    open: launching,
    title: "Launching",
    width: 360
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-ui)",
      color: "var(--text-body)"
    }
  }, "Handing off to the engine."), /*#__PURE__*/React.createElement(Meter, {
    indeterminate: true
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
      color: "var(--text-low)"
    }
  }, "Shiro goes dormant while the match runs and comes back with your results."))));
  return /*#__PURE__*/React.createElement(AppShell, {
    view: view,
    onView: v => {
      setRoom(null);
      setView(v);
    },
    connection: "online",
    users: D.welcome.UserCount,
    engine: D.welcome.Engine,
    game: D.welcome.Game,
    overlay: overlay
  }, body);
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
setInterval(() => window.lucide && window.lucide.createIcons({
  nameAttr: "data-lucide"
}), 400);
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lobby/AppShell.jsx
try { (() => {
const {
  IconButton,
  Icon,
  Badge
} = window.ShiroDesignSystem_0f4b7d;
const NAV = [{
  id: "battles",
  icon: "swords",
  label: "Battles"
}, {
  id: "chat",
  icon: "message-square",
  label: "Chat"
}, {
  id: "queue",
  icon: "target",
  label: "Matchmaker"
}, {
  id: "friends",
  icon: "users",
  label: "Friends"
}, {
  id: "debrief",
  icon: "trophy",
  label: "Last match"
}];
function TitleBar() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "var(--shell-titlebar)",
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-5)",
      padding: "0 var(--sp-3) 0 var(--sp-5)",
      borderBottom: "1px solid var(--w-12)",
      background: "var(--surface-base)"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark.svg",
    width: "15",
    height: "15",
    alt: "",
    style: {
      opacity: 0.9
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) var(--size-micro)/1 var(--font-core)",
      fontStretch: "100%",
      letterSpacing: "var(--track-wordmark)",
      color: "var(--text-hi)"
    }
  }, "SHIRO"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)",
      color: "var(--text-faint)"
    }
  }, "0.1.0"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 0
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "minus",
    label: "Minimise",
    size: "sm"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "square",
    label: "Maximise",
    size: "sm"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "x",
    label: "Close",
    size: "sm"
  })));
}
function NavRail({
  view,
  onView
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      width: "var(--shell-nav)",
      flex: "0 0 auto",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "var(--sp-2)",
      padding: "var(--sp-4) 0",
      borderRight: "1px solid var(--w-12)",
      background: "var(--surface-sunken)"
    }
  }, NAV.map(n => /*#__PURE__*/React.createElement("div", {
    key: n.id,
    style: {
      position: "relative",
      width: "100%",
      display: "flex",
      justifyContent: "center"
    }
  }, view === n.id && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 0,
      top: 3,
      bottom: 3,
      width: 2,
      background: "var(--ink-000)"
    }
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: n.icon,
    label: n.label,
    size: "lg",
    active: view === n.id,
    onClick: () => onView(n.id)
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "download",
    label: "Downloads",
    size: "lg"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "settings",
    label: "Settings",
    size: "lg"
  }));
}
function StatusBar({
  connection = "online",
  users,
  engine,
  game,
  onReconnect
}) {
  const map = {
    online: {
      icon: "wifi",
      text: "Connected",
      color: "var(--text-low)"
    },
    reconnecting: {
      icon: "loader",
      text: "Reconnecting · attempt 3",
      color: "var(--signal-warn)"
    },
    offline: {
      icon: "wifi-off",
      text: "Lost connection",
      color: "var(--signal-danger)"
    }
  }[connection];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "var(--shell-statusbar)",
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-6)",
      padding: "0 var(--sp-5)",
      borderTop: "1px solid var(--w-12)",
      background: "var(--surface-sunken)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--sp-3)",
      color: map.color
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: map.icon,
    size: 14,
    style: {
      width: 12,
      height: 12,
      animation: connection === "reconnecting" ? "shiro-pulse 1s var(--ease-standard) infinite" : "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-label)",
      letterSpacing: "var(--track-label-tight)",
      textTransform: "uppercase"
    }
  }, map.text)), connection !== "online" && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onReconnect,
    style: {
      background: "none",
      border: 0,
      padding: 0,
      cursor: "pointer",
      font: "var(--w-medium) var(--size-micro)/1 var(--font-core)",
      color: "var(--text-hi)",
      textDecoration: "underline"
    }
  }, "Retry now"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)",
      color: "var(--text-low)",
      fontVariantNumeric: "tabular-nums"
    }
  }, users, " online"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)",
      color: "var(--text-faint)"
    }
  }, "engine ", engine), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-micro)/1 var(--font-mono)",
      color: "var(--text-faint)"
    }
  }, game));
}
function AppShell({
  view,
  onView,
  connection,
  users,
  engine,
  game,
  onReconnect,
  children,
  overlay
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
      background: "var(--surface-base)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement(TitleBar, null), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(NavRail, {
    view: view,
    onView: onView
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: "flex"
    }
  }, children)), /*#__PURE__*/React.createElement(StatusBar, {
    connection: connection,
    users: users,
    engine: engine,
    game: game,
    onReconnect: onReconnect
  }), overlay);
}
Object.assign(window, {
  AppShell,
  TitleBar,
  NavRail,
  StatusBar,
  NAV
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lobby/BattleListScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  BattleRow,
  Panel,
  Button,
  Input,
  Select,
  Checkbox,
  Badge,
  Icon,
  MapImage,
  UserChip,
  EmptyState,
  IconButton
} = window.ShiroDesignSystem_0f4b7d;

/* Screen 3 — the default view and the highest-traffic surface.
   Left: filter strip. Centre: the list. Right: detail for the selected battle. */
function BattleListScreen({
  battles,
  onJoin,
  empty,
  onToggleEmpty
}) {
  const [sel, setSel] = React.useState(battles[0] && battles[0].id);
  const [q, setQ] = React.useState("");
  const [mode, setMode] = React.useState("All modes");
  const [hideRunning, setHideRunning] = React.useState(false);
  const list = (empty ? [] : battles).filter(b => (mode === "All modes" || b.mode === mode) && (!hideRunning || !b.running) && (q === "" || (b.title + " " + b.founder + " " + b.map).toLowerCase().includes(q.toLowerCase())));
  const current = list.find(b => b.id === sel) || list[0];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gridTemplateColumns: "200px minmax(0,1fr) 300px",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-6)",
      padding: "var(--sp-5)",
      borderRight: "1px solid var(--w-12)",
      background: "var(--surface-sunken)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus",
    block: true
  }, "Host a battle"), /*#__PURE__*/React.createElement(Input, {
    label: "Filter",
    placeholder: "Title, host, map",
    icon: "search",
    value: q,
    onChange: e => setQ(e.target.value)
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Mode",
    value: mode,
    onChange: e => setMode(e.target.value),
    options: ["All modes", "Teams", "1v1", "FFA", "Coop"]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "Hide running",
    checked: hideRunning,
    onChange: e => setHideRunning(e.target.checked)
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Hide passworded",
    checked: false,
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Show off-peak state",
    checked: empty,
    onChange: onToggleEmpty,
    hint: "Demo toggle"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 26,
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-5)",
      padding: "0 var(--sp-5) 0 var(--sp-5)",
      borderBottom: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab",
    style: {
      width: 96
    }
  }, "MAP"), /*#__PURE__*/React.createElement("span", {
    className: "lab",
    style: {
      flex: 1
    }
  }, "BATTLE"), /*#__PURE__*/React.createElement("span", {
    className: "lab",
    style: {
      width: 88,
      textAlign: "right"
    }
  }, "MODE"), /*#__PURE__*/React.createElement("span", {
    className: "lab",
    style: {
      width: 62,
      textAlign: "right"
    }
  }, "PLAYERS"), /*#__PURE__*/React.createElement("span", {
    className: "lab",
    style: {
      width: 44,
      textAlign: "right"
    }
  }, "SPEC"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 74
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto"
    }
  }, list.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    numeral: 100,
    title: "No battles open right now.",
    body: "Off-peak hours are quiet. 100 players are online \u2014 start one and they will come.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus"
    }, "Host a battle")
  }) : list.map((b, i) => /*#__PURE__*/React.createElement(BattleRow, _extends({
    key: b.id
  }, b, {
    selected: current && current.id === b.id,
    onClick: () => setSel(b.id),
    onJoin: () => onJoin(b),
    style: {
      animation: "shiro-enter var(--dur-base) var(--ease-out) " + Math.min(i, 12) * 12 + "ms both"
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: "1px solid var(--w-12)",
      background: "var(--surface-panel)",
      display: "flex",
      flexDirection: "column",
      minHeight: 0
    }
  }, current ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(MapImage, {
    map: current.map,
    kind: "minimap",
    ratio: "1",
    caption: true,
    link: true,
    saturate: 1,
    style: {
      flex: "0 0 auto"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-5)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-5)",
      borderBottom: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-heading)",
      color: "var(--text-hi)"
    }
  }, current.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--sp-3)"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "outline"
  }, current.mode), /*#__PURE__*/React.createElement(Badge, {
    mono: true
  }, current.players, "/", current.maxPlayers), current.locked && /*#__PURE__*/React.createElement(Badge, {
    tone: "outline",
    icon: "lock"
  }, "Locked"), current.running && /*#__PURE__*/React.createElement(Badge, {
    tone: "danger"
  }, "In progress"), current.matchmaker && /*#__PURE__*/React.createElement(Badge, {
    tone: "solid"
  }, "MM")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: "var(--sp-3) var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "HOST"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-ui-sm)",
      color: "var(--text-body)"
    }
  }, current.founder), /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "MAP"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-tiny)/1.3 var(--font-mono)",
      color: "var(--text-body)",
      overflowWrap: "anywhere"
    }
  }, current.map), /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "ENGINE"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1.3 var(--font-mono)",
      color: "var(--text-faint)"
    }
  }, "2025.06.21"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      padding: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "IN THIS ROOM"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)",
      marginTop: "var(--sp-4)"
    }
  }, ["hexed", "quantum", "tinman", "lorelei", "marrow", "nine"].slice(0, Math.max(2, Math.min(6, current.players))).map(n => /*#__PURE__*/React.createElement(UserChip, {
    key: n,
    name: n,
    presence: "room",
    size: "sm"
  })), current.players > 6 && /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "+", current.players - 6, " MORE"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-5)",
      borderTop: "1px solid var(--w-12)",
      display: "flex",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    style: {
      flex: 1
    },
    icon: current.running ? "eye" : "play",
    onClick: () => onJoin(current)
  }, current.running ? "Watch" : "Join battle"), /*#__PURE__*/React.createElement(IconButton, {
    icon: "eye",
    label: "Spectate",
    variant: "outline",
    size: "lg"
  }))) : /*#__PURE__*/React.createElement(EmptyState, {
    icon: "swords",
    title: "Nothing selected.",
    body: "Pick a battle to see its map and players."
  })));
}
Object.assign(window, {
  BattleListScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/BattleListScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lobby/BattleRoomScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  Panel,
  Button,
  Badge,
  Tag,
  PlayerRow,
  ChatLine,
  MapImage,
  Input,
  IconButton,
  Icon,
  UserChip,
  EmptyState
} = window.ShiroDesignSystem_0f4b7d;

/* Screen 4 — the largest and densest screen. Teams, spectators, bots, map,
   options, chat, ready/start. Team columns are a grid so 1v1 and 16-way FFA
   use the same layout. */
function TeamColumn({
  ally,
  players,
  max = 8
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      borderRight: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 26,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 var(--sp-4)",
      borderBottom: "1px solid var(--w-06)",
      background: "var(--w-04)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "TEAM ", ally + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)",
      color: "var(--text-low)",
      fontVariantNumeric: "tabular-nums"
    }
  }, players.length, "/", max)), players.map((p, i) => /*#__PURE__*/React.createElement(PlayerRow, _extends({
    key: i
  }, p, {
    user: p.user,
    right: /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
        color: "var(--text-low)",
        fontVariantNumeric: "tabular-nums"
      }
    }, p.user.elo || "")
  }))), Array.from({
    length: Math.max(0, Math.min(3, max - players.length))
  }).map((_, i) => /*#__PURE__*/React.createElement("div", {
    key: "e" + i,
    style: {
      height: "var(--row-default)",
      display: "flex",
      alignItems: "center",
      padding: "0 var(--sp-4)",
      boxShadow: "var(--rule-inset)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1 var(--font-core)",
      color: "var(--text-faint)"
    }
  }, "empty"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    size: "sm",
    block: true
  }, "Join team ", ally + 1)));
}
function BattleRoomScreen({
  room,
  onLeave,
  onStart
}) {
  const [ready, setReady] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const total = room.teams.reduce((n, t) => n + t.players.length, 0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 320px",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-5)",
      padding: "0 var(--sp-5)",
      borderBottom: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "arrow-left",
    label: "Back to battles",
    onClick: onLeave
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-semibold) var(--size-mid)/1 var(--font-core)",
      color: "var(--text-hi)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, room.title), /*#__PURE__*/React.createElement(Badge, {
    tone: "outline"
  }, room.mode), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "HOST"), /*#__PURE__*/React.createElement(UserChip, {
    name: room.founder,
    size: "sm",
    presence: "room"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: "grid",
      gridTemplateColumns: "repeat(" + room.teams.length + ", minmax(0,1fr))",
      overflowY: "auto"
    }
  }, room.teams.map(t => /*#__PURE__*/React.createElement(TeamColumn, {
    key: t.ally,
    ally: t.ally,
    players: t.players,
    max: 8
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "0 0 auto",
      borderTop: "1px solid var(--w-12)",
      display: "flex",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      height: 200
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 26,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 var(--sp-5)",
      borderBottom: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "ROOM CHAT"), /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, total, " PLAYERS \xB7 ", room.spectators.length, " SPECTATORS")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      paddingTop: "var(--sp-2)"
    }
  }, room.chat.map((c, i) => /*#__PURE__*/React.createElement(ChatLine, _extends({
    key: i
  }, c)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-4)",
      padding: "var(--sp-4) var(--sp-5)",
      borderTop: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Message the room",
    value: msg,
    onChange: e => setMsg(e.target.value),
    wrapStyle: {
      flex: 1
    },
    size: "sm"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    size: "sm",
    onClick: () => setMsg("")
  }, "Send"))), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 220,
      flex: "0 0 auto",
      borderLeft: "1px solid var(--w-06)",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 26,
      display: "flex",
      alignItems: "center",
      padding: "0 var(--sp-4)",
      borderBottom: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "SPECTATORS")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto"
    }
  }, room.spectators.map((s, i) => /*#__PURE__*/React.createElement(PlayerRow, _extends({
    key: i,
    spectator: true
  }, s))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: "1px solid var(--w-12)",
      background: "var(--surface-panel)",
      display: "flex",
      flexDirection: "column",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(MapImage, {
    map: room.map,
    kind: "minimap",
    ratio: "1",
    caption: true,
    link: true,
    saturate: 1,
    style: {
      flex: "0 0 auto"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      padding: "var(--sp-5)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-6)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "MOD OPTIONS"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--sp-3)"
    }
  }, room.options.map(([k, v]) => /*#__PURE__*/React.createElement(Tag, {
    key: k,
    value: v || undefined
  }, k)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "SYNC"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 16,
    style: {
      color: "var(--text-mid)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-ui-sm)",
      color: "var(--text-body)"
    }
  }, "You have the map and game")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 16,
    style: {
      color: "var(--text-low)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
      color: "var(--text-low)"
    }
  }, "1 player is still downloading")))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-5)",
      borderTop: "1px solid var(--w-12)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: ready ? "secondary" : "primary",
    size: "lg",
    block: true,
    icon: ready ? "check" : undefined,
    onClick: () => setReady(!ready)
  }, ready ? "Ready" : "Ready up"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    block: true,
    icon: "play",
    disabled: !ready,
    onClick: onStart
  }, "Start"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    style: {
      flex: 1
    }
  }, "Spectate"), /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "sm",
    style: {
      flex: 1
    },
    onClick: onLeave
  }, "Leave")))));
}
Object.assign(window, {
  BattleRoomScreen,
  TeamColumn
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/BattleRoomScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lobby/ChatScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  Tabs,
  ChatLine,
  Input,
  Button,
  UserChip,
  Panel,
  IconButton,
  EmptyState
} = window.ShiroDesignSystem_0f4b7d;

/* Screen 5 — channels and DMs. Tabs carry unread counts and mention (Ring) state. */
function ChatScreen({
  channels,
  users,
  messages
}) {
  const [tab, setTab] = React.useState(channels[0].id);
  const [msg, setMsg] = React.useState("");
  const [lines, setLines] = React.useState(messages);
  const send = () => {
    if (!msg.trim()) return;
    setLines(l => [...l, {
      time: "21:07",
      user: {
        name: "Shadowfury",
        clan: "ZKF",
        country: "DE"
      },
      text: msg
    }]);
    setMsg("");
  };
  const isDm = (channels.find(c => c.id === tab) || {}).dm;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 240px",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    items: channels
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      paddingTop: "var(--sp-4)"
    }
  }, isDm ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "message-square",
    title: "Nothing in this conversation yet.",
    body: "Say something."
  }) : lines.map((l, i) => /*#__PURE__*/React.createElement(ChatLine, _extends({
    key: i
  }, l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-4)",
      padding: "var(--sp-4) var(--sp-5)",
      borderTop: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Message " + tab,
    value: msg,
    onChange: e => setMsg(e.target.value),
    onKeyDown: e => e.key === "Enter" && send(),
    wrapStyle: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    onClick: send
  }, "Send"))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: "1px solid var(--w-12)",
      background: "var(--surface-panel)",
      display: "flex",
      flexDirection: "column",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 26,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 var(--sp-4)",
      borderBottom: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "IN CHANNEL"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-micro)/1 var(--font-mono)",
      color: "var(--text-low)"
    }
  }, users.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      padding: "var(--sp-2) 0"
    }
  }, users.map(u => /*#__PURE__*/React.createElement("div", {
    key: u.name,
    style: {
      height: "var(--row-compact)",
      display: "flex",
      alignItems: "center",
      padding: "0 var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(UserChip, _extends({}, u, {
    size: "sm",
    style: {
      minWidth: 0
    }
  })))))));
}
Object.assign(window, {
  ChatScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/ChatScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lobby/DebriefingScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  Panel,
  Meter,
  Badge,
  Tag,
  Button,
  RatingDelta,
  UserChip,
  MapImage,
  Icon
} = window.ShiroDesignSystem_0f4b7d;

/* Screen 7 — the richest payload in the protocol, arriving at the emotional
   peak of the session. Display type states the result; everything else is mono. */
function ResultRow({
  p
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-4)",
      height: "var(--row-default)",
      padding: "0 var(--sp-4)",
      boxShadow: "var(--rule-inset)"
    }
  }, /*#__PURE__*/React.createElement(UserChip, _extends({}, p.user, {
    size: "sm",
    style: {
      flex: 1,
      minWidth: 0
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 46,
      textAlign: "right",
      font: "var(--w-medium) var(--size-tiny)/1 var(--font-mono)",
      color: "var(--text-mid)",
      fontVariantNumeric: "tabular-nums"
    }
  }, p.elo), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement(RatingDelta, {
    value: p.change,
    size: "sm"
  })));
}
function DebriefingScreen({
  d,
  onBack
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 340px",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      minHeight: 0,
      overflowY: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: "var(--sp-8)",
      padding: "var(--sp-9) var(--sp-8) var(--sp-8)",
      borderBottom: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-display)",
      letterSpacing: "var(--track-display)",
      color: "var(--text-hi)"
    }
  }, d.result), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-3)",
      paddingBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, d.mode, " \xB7 ", d.category), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-medium) var(--size-small)/1 var(--font-mono)",
      color: "var(--text-mid)"
    }
  }, d.duration)), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: onBack
  }, "Back to battles")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      borderBottom: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      borderRight: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 26,
      display: "flex",
      alignItems: "center",
      padding: "0 var(--sp-4)",
      borderBottom: "1px solid var(--w-06)",
      background: "var(--w-04)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "YOUR TEAM \xB7 WON")), d.team.map((p, i) => /*#__PURE__*/React.createElement(ResultRow, {
    key: i,
    p: p
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 26,
      display: "flex",
      alignItems: "center",
      padding: "0 var(--sp-4)",
      borderBottom: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "OPPONENTS")), d.opponents.map((p, i) => /*#__PURE__*/React.createElement(ResultRow, {
    key: i,
    p: p
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-6) var(--sp-8)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "AWARDS"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--sp-4)"
    }
  }, d.awards.map(a => /*#__PURE__*/React.createElement(Tag, {
    key: a.name,
    value: a.value
  }, a.name))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: "1px solid var(--w-12)",
      background: "var(--surface-panel)",
      display: "flex",
      flexDirection: "column",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(MapImage, {
    map: d.map,
    kind: "minimap",
    ratio: "1",
    caption: true,
    link: true,
    saturate: 1,
    style: {
      flex: "0 0 auto"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-6)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-8)",
      flex: 1,
      minHeight: 0,
      overflowY: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "RATING"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-num-lg)",
      color: "var(--text-hi)",
      fontVariantNumeric: "tabular-nums"
    }
  }, d.elo.next), /*#__PURE__*/React.createElement(RatingDelta, {
    value: d.elo.change,
    size: "md"
  })), d.elo.rankup && /*#__PURE__*/React.createElement(Badge, {
    tone: "solid",
    icon: "chevron-up"
  }, "Rank up \u2014 ", d.elo.rank), /*#__PURE__*/React.createElement(Meter, {
    label: "Next rank",
    right: d.elo.next + " / " + d.elo.nextRankElo,
    value: d.elo.next - d.elo.prevRankElo,
    max: d.elo.nextRankElo - d.elo.prevRankElo
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "EXPERIENCE"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: "var(--sp-5)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) var(--size-xl)/1 var(--font-mono)",
      color: "var(--text-hi)",
      fontVariantNumeric: "tabular-nums"
    }
  }, "L", d.xp.level), /*#__PURE__*/React.createElement(RatingDelta, {
    value: d.xp.change,
    size: "sm"
  })), /*#__PURE__*/React.createElement(Meter, {
    label: "Next level",
    right: d.xp.next + " / " + d.xp.nextLevelXp,
    value: d.xp.next - d.xp.prevLevelXp,
    max: d.xp.nextLevelXp - d.xp.prevLevelXp
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--sp-5)",
      borderTop: "1px solid var(--w-12)",
      display: "flex",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    style: {
      flex: 1
    },
    icon: "rotate-ccw"
  }, "Play again"))));
}
Object.assign(window, {
  DebriefingScreen,
  ResultRow
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/DebriefingScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lobby/FriendsScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  Panel,
  Button,
  UserChip,
  PresenceDot,
  EmptyState,
  IconButton,
  Badge,
  Meter,
  Tag
} = window.ShiroDesignSystem_0f4b7d;

/* Screen 8 — friends list and the profile detail: badges, level, three ratings. */
function FriendsScreen({
  users
}) {
  const [sel, setSel] = React.useState(users[1].name);
  const u = users.find(x => x.name === sel);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 320px",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 26,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 var(--sp-5)",
      borderBottom: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "FRIENDS"), /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, users.length, " TOTAL")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto"
    }
  }, users.map(x => /*#__PURE__*/React.createElement("div", {
    key: x.name,
    onClick: () => setSel(x.name),
    style: {
      position: "relative",
      height: "var(--row-tall)",
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-5)",
      padding: "0 var(--sp-5)",
      cursor: "pointer",
      background: x.name === sel ? "var(--surface-selected)" : "transparent",
      boxShadow: "var(--rule-inset)"
    }
  }, x.name === sel && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: 2,
      background: "var(--ink-000)"
    }
  }), /*#__PURE__*/React.createElement(UserChip, _extends({}, x, {
    style: {
      flex: 1,
      minWidth: 0
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, x.presence === "ingame" ? "IN GAME" : x.presence === "room" ? "IN ROOM" : x.presence === "away" ? "AWAY" : "ONLINE"), /*#__PURE__*/React.createElement(IconButton, {
    icon: "message-square",
    label: "Message",
    size: "sm"
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: "1px solid var(--w-12)",
      background: "var(--surface-panel)",
      padding: "var(--sp-6)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-8)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "PROFILE"), /*#__PURE__*/React.createElement(UserChip, u), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--sp-3)"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "outline"
  }, "Level ", u.level), u.admin && /*#__PURE__*/React.createElement(Badge, {
    tone: "solid"
  }, "Admin"), u.bot && /*#__PURE__*/React.createElement(Badge, {
    tone: "outline"
  }, "Bot"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      gap: "var(--sp-4) var(--sp-6)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "GENERAL ELO"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-num)",
      color: "var(--text-hi)",
      textAlign: "right",
      fontVariantNumeric: "tabular-nums"
    }
  }, u.elo || "—"), /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "MATCHMAKER"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-num)",
      color: "var(--text-hi)",
      textAlign: "right",
      fontVariantNumeric: "tabular-nums"
    }
  }, u.elo ? u.elo - 76 : "—"), /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "1V1"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-num)",
      color: "var(--text-hi)",
      textAlign: "right",
      fontVariantNumeric: "tabular-nums"
    }
  }, u.elo ? u.elo + 34 : "—")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "BADGES"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
      color: "var(--text-faint)"
    }
  }, "Badge image assets are unresolved \u2014 engineering will supply the URL scheme for Avatar, Icon and Badges[].")), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    style: {
      flex: 1
    }
  }, "Message"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    style: {
      flex: 1
    }
  }, "Ignore"))));
}
Object.assign(window, {
  FriendsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/FriendsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lobby/LoginScreen.jsx
try { (() => {
const {
  Button,
  Input,
  Checkbox,
  Icon
} = window.ShiroDesignSystem_0f4b7d;

/* Screen 1. First impression, and the only place the "Steam users must set a
   password" caveat is explained. Pure black — the one surface that gets it. */
function LoginScreen({
  onLogin
}) {
  const [name, setName] = React.useState("Shadowfury");
  const [pw, setPw] = React.useState("hunter2");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const submit = () => {
    if (!name || !pw) {
      setError("Enter a name and password.");
      return;
    }
    setBusy(true);
    setError("");
    setTimeout(() => {
      setBusy(false);
      onLogin();
    }, 700);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gridTemplateColumns: "1fr 400px",
      minHeight: 0,
      background: "var(--surface-void)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: "var(--sp-9)",
      padding: "var(--sp-12)",
      borderRight: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--sp-6)"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo-mark.svg",
    width: "72",
    height: "72",
    alt: "",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-bold) var(--size-4xl)/1 var(--font-core)",
      fontStretch: "100%",
      letterSpacing: "var(--track-wordmark)",
      color: "var(--text-hi)"
    }
  }, "SHIRO")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)",
      maxWidth: "44ch"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-mid)/1.5 var(--font-core)",
      color: "var(--text-mid)"
    }
  }, "A lobby client for Zero-K."), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-small)/1.6 var(--font-core)",
      color: "var(--text-low)"
    }
  }, "Shiro reuses your existing Zero-K installation for the engine, game and maps."))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: "var(--sp-6)",
      padding: "var(--sp-9)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-label)",
      letterSpacing: "var(--track-label)",
      textTransform: "uppercase",
      color: "var(--text-low)"
    }
  }, "LOG IN"), /*#__PURE__*/React.createElement(Input, {
    label: "Account name",
    value: name,
    onChange: e => setName(e.target.value),
    icon: "user"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Password",
    type: "password",
    value: pw,
    onChange: e => setPw(e.target.value),
    error: error || undefined
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Stay logged in",
    checked: true,
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    block: true,
    loading: busy,
    onClick: submit
  }, busy ? "Connecting" : "Log in"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    block: true
  }, "Create an account"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--sp-4)",
      padding: "var(--sp-5)",
      background: "var(--surface-sunken)",
      border: "1px solid var(--w-06)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 14,
    style: {
      color: "var(--text-low)",
      marginTop: 2
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
      color: "var(--text-low)"
    }
  }, "Steam accounts need a lobby password. Set one on zero-k.info, then log in here."))));
}
Object.assign(window, {
  LoginScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/LoginScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lobby/QueueScreen.jsx
try { (() => {
const {
  Button,
  Panel,
  Meter,
  Badge,
  UserChip,
  Icon
} = window.ShiroDesignSystem_0f4b7d;

/* Screen 6 — matchmaker queue. The ready-check itself is a Dialog rendered by
   App as a shell overlay, because it can interrupt any screen. */
const QUEUES = [{
  id: "1v1",
  label: "1v1",
  waiting: 6,
  avg: "0:48"
}, {
  id: "teams",
  label: "Teams",
  waiting: 21,
  avg: "1:12"
}, {
  id: "coop",
  label: "Coop vs AI",
  waiting: 3,
  avg: "2:30"
}];
function QueueScreen({
  queued,
  onQueue,
  onFake
}) {
  const [picked, setPicked] = React.useState(["teams"]);
  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 320px",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 26,
      display: "flex",
      alignItems: "center",
      padding: "0 var(--sp-5)",
      borderBottom: "1px solid var(--w-12)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "QUEUES")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto"
    }
  }, QUEUES.map(q => {
    const on = picked.includes(q.id);
    return /*#__PURE__*/React.createElement("div", {
      key: q.id,
      onClick: () => toggle(q.id),
      style: {
        position: "relative",
        height: "var(--row-tall)",
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-5)",
        padding: "0 var(--sp-5)",
        cursor: "pointer",
        background: on ? "var(--surface-selected)" : "transparent",
        boxShadow: "var(--rule-inset)"
      }
    }, on && /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 2,
        background: "var(--ink-000)"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--text-heading)",
        color: on ? "var(--text-hi)" : "var(--text-body)",
        flex: 1
      }
    }, q.label), /*#__PURE__*/React.createElement("span", {
      className: "lab"
    }, "WAITING"), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 34,
        textAlign: "right",
        font: "var(--w-medium) var(--size-small)/1 var(--font-mono)",
        color: "var(--text-hi)",
        fontVariantNumeric: "tabular-nums"
      }
    }, q.waiting), /*#__PURE__*/React.createElement("span", {
      className: "lab"
    }, "AVG WAIT"), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 48,
        textAlign: "right",
        font: "var(--w-medium) var(--size-small)/1 var(--font-mono)",
        color: "var(--text-mid)",
        fontVariantNumeric: "tabular-nums"
      }
    }, q.avg));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderLeft: "1px solid var(--w-12)",
      background: "var(--surface-panel)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-6)",
      padding: "var(--sp-6)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-3)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "YOUR MATCHMAKER RATING"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--text-num-lg)",
      color: "var(--text-hi)",
      fontVariantNumeric: "tabular-nums"
    }
  }, "1766")), queued ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Meter, {
    indeterminate: true,
    label: "Searching",
    right: picked.join(" · ")
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
      color: "var(--text-low)"
    }
  }, "You can keep browsing battles while you wait. Shiro will interrupt when a match is found."), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    block: true,
    onClick: () => onQueue(false)
  }, "Leave queue"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    block: true,
    onClick: onFake
  }, "Simulate match found")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
      color: "var(--text-low)"
    }
  }, "Pick one or more queues. ", picked.length ? picked.length + " selected." : "None selected."), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    block: true,
    disabled: !picked.length,
    onClick: () => onQueue(true)
  }, "Join queue")), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--sp-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "lab"
  }, "PARTY"), /*#__PURE__*/React.createElement(UserChip, {
    name: "Shadowfury",
    clan: "ZKF",
    country: "DE",
    faction: "machines",
    level: 41,
    elo: 1842,
    size: "sm"
  }), /*#__PURE__*/React.createElement(UserChip, {
    name: "quantum",
    clan: "ZKF",
    country: "PL",
    faction: "rising",
    level: 12,
    elo: 1503,
    size: "sm"
  }))));
}
Object.assign(window, {
  QueueScreen,
  QUEUES
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/QueueScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/lobby/data.js
try { (() => {
/* Fake data shaped exactly like the ZkLobbyServer payloads documented in
   NewLobby/docs/DESIGN_HANDOFF.md section 6. */
window.SHIRO_DATA = {
  welcome: {
    Engine: "2025.06.21",
    Game: "Zero-K v1.14.8.0",
    UserCount: 100
  },
  me: {
    name: "Shadowfury",
    clan: "ZKF",
    country: "DE",
    faction: "machines",
    level: 41,
    elo: 1842,
    mmElo: 1766
  },
  battles: [{
    id: 1,
    title: "Teams 8v8 · no noobs",
    map: "Argent_Strata_1.1",
    founder: "Shadowfury",
    players: 11,
    maxPlayers: 16,
    spectators: 3,
    mode: "Teams"
  }, {
    id: 2,
    title: "1v1 ladder",
    map: "Canis_River_v1.4",
    founder: "quantum",
    players: 2,
    maxPlayers: 2,
    spectators: 12,
    mode: "1v1",
    matchmaker: true
  }, {
    id: 3,
    title: "private — do not join",
    map: "Rainbow_Comet_v1.25",
    founder: "ZKF|hexed",
    players: 8,
    maxPlayers: 8,
    spectators: 0,
    mode: "FFA",
    locked: true,
    running: true,
    runningSince: 252
  }, {
    id: 4,
    title: "newbies welcome, will explain",
    map: "Hide_and_Seek_2.2.3",
    founder: "tinman",
    players: 4,
    maxPlayers: 12,
    spectators: 1,
    mode: "Teams"
  }, {
    id: 5,
    title: "coop vs 4 brutal AI",
    map: "Skate_Park_v1.00",
    founder: "lorelei",
    players: 3,
    maxPlayers: 8,
    spectators: 0,
    mode: "Coop"
  }, {
    id: 6,
    title: "FFA 8 way chaos",
    map: "Rainbow_Comet_v1.25",
    founder: "vex",
    players: 6,
    maxPlayers: 8,
    spectators: 2,
    mode: "FFA"
  }, {
    id: 7,
    title: "clan practice [ZKF] only",
    map: "Argent_Strata_1.1",
    founder: "ZKF|nine",
    players: 9,
    maxPlayers: 16,
    spectators: 0,
    mode: "Teams",
    locked: true
  }, {
    id: 8,
    title: "1v1 casual anyone",
    map: "Canis_River_v1.4",
    founder: "a",
    players: 1,
    maxPlayers: 2,
    spectators: 0,
    mode: "1v1"
  }, {
    id: 9,
    title: "big teams 16v16 come on",
    map: "Skate_Park_v1.00",
    founder: "marrow",
    players: 22,
    maxPlayers: 32,
    spectators: 5,
    mode: "Teams"
  }, {
    id: 10,
    title: "running — 40 min in",
    map: "Hide_and_Seek_2.2.3",
    founder: "pell",
    players: 12,
    maxPlayers: 12,
    spectators: 8,
    mode: "Teams",
    running: true,
    runningSince: 2464
  }],
  room: {
    id: 1,
    title: "Teams 8v8 · no noobs",
    map: "Argent_Strata_1.1",
    founder: "Shadowfury",
    mode: "Teams",
    options: [["commshare", null], ["multiplier", "2.0"], ["startmetal", "1300"], ["maxunits", "2000"], ["deathmode", "allunits"]],
    teams: [{
      ally: 0,
      players: [{
        user: {
          name: "Shadowfury",
          clan: "ZKF",
          country: "DE",
          faction: "machines",
          level: 41,
          elo: 1842
        },
        host: true
      }, {
        user: {
          name: "quantum",
          clan: "ZKF",
          country: "PL",
          faction: "rising",
          level: 12,
          elo: 1503
        },
        party: 1
      }, {
        user: {
          name: "tinman",
          country: "GB",
          faction: "hegemony",
          level: 27,
          elo: 1671
        },
        party: 1
      }, {
        user: {
          name: "a",
          country: "JP",
          faction: "rising",
          level: 3,
          elo: 987,
          presence: "away"
        }
      }, {
        user: {
          name: "CAI-Brutal",
          bot: true
        },
        sync: "ok"
      }]
    }, {
      ally: 1,
      players: [{
        user: {
          name: "hexed",
          clan: "ZKF",
          country: "US",
          faction: "machines",
          level: 33,
          elo: 1790
        }
      }, {
        user: {
          name: "lorelei",
          country: "FR",
          faction: "hegemony",
          level: 19,
          elo: 1588
        },
        sync: "downloading"
      }, {
        user: {
          name: "vexatiousmachinist",
          country: "BR",
          faction: "rising",
          level: 8,
          elo: 1204
        },
        sync: "missing"
      }, {
        user: {
          name: "marrow",
          country: "SE",
          faction: "machines",
          level: 44,
          elo: 1955
        }
      }]
    }],
    spectators: [{
      user: {
        name: "pell",
        country: "NL",
        presence: "room",
        level: 52,
        elo: 2210
      }
    }, {
      user: {
        name: "nine",
        clan: "ZKF",
        country: "CA",
        presence: "room",
        level: 21,
        elo: 1499
      }
    }, {
      user: {
        name: "zk-admin",
        country: "US",
        presence: "room",
        admin: true,
        level: 60,
        elo: 2400
      }
    }],
    chat: [{
      time: "21:03",
      user: {
        name: "quantum",
        clan: "ZKF",
        country: "PL"
      },
      text: "map veto?"
    }, {
      time: "21:03",
      user: {
        name: "Shadowfury",
        clan: "ZKF",
        country: "DE"
      },
      text: "argent is fine, it's balanced enough for 8v8"
    }, {
      time: "21:04",
      emote: true,
      user: {
        name: "hexed"
      },
      text: "rolls a die"
    }, {
      time: "21:04",
      system: true,
      text: "lorelei joined the room"
    }, {
      time: "21:05",
      user: {
        name: "lorelei",
        country: "FR"
      },
      text: "downloading the map, one sec"
    }, {
      time: "21:05",
      ring: true,
      user: {
        name: "hexed",
        clan: "ZKF",
        country: "US"
      },
      text: "you're up — we need one more on team 2 or this never starts"
    }]
  },
  channels: [{
    id: "zk",
    label: "#zk",
    unread: 12
  }, {
    id: "newbies",
    label: "#newbies"
  }, {
    id: "main",
    label: "#main",
    unread: 3
  }, {
    id: "hexed",
    label: "hexed",
    mention: true,
    dm: true
  }],
  channelUsers: [{
    name: "Shadowfury",
    clan: "ZKF",
    country: "DE",
    faction: "machines",
    presence: "room",
    level: 41,
    elo: 1842
  }, {
    name: "hexed",
    clan: "ZKF",
    country: "US",
    faction: "machines",
    presence: "online",
    level: 33,
    elo: 1790
  }, {
    name: "quantum",
    clan: "ZKF",
    country: "PL",
    faction: "rising",
    presence: "room",
    level: 12,
    elo: 1503
  }, {
    name: "marrow",
    country: "SE",
    faction: "machines",
    presence: "ingame",
    level: 44,
    elo: 1955
  }, {
    name: "pell",
    country: "NL",
    presence: "ingame",
    level: 52,
    elo: 2210
  }, {
    name: "lorelei",
    country: "FR",
    faction: "hegemony",
    presence: "away",
    level: 19,
    elo: 1588
  }, {
    name: "tinman",
    country: "GB",
    faction: "hegemony",
    presence: "online",
    level: 27,
    elo: 1671
  }, {
    name: "zk-admin",
    country: "US",
    admin: true,
    presence: "online",
    level: 60,
    elo: 2400
  }, {
    name: "a",
    country: "JP",
    faction: "rising",
    presence: "away",
    level: 3,
    elo: 987
  }, {
    name: "vexatiousmachinist",
    country: "BR",
    faction: "rising",
    presence: "online",
    level: 8,
    elo: 1204
  }, {
    name: "nine",
    clan: "ZKF",
    country: "CA",
    presence: "online",
    level: 21,
    elo: 1499
  }, {
    name: "CAI-Brutal",
    bot: true,
    presence: "online"
  }],
  channelChat: [{
    time: "20:51",
    user: {
      name: "tinman",
      country: "GB"
    },
    text: "anyone up for teams"
  }, {
    time: "20:52",
    user: {
      name: "nine",
      clan: "ZKF",
      country: "CA"
    },
    text: "in 10"
  }, {
    time: "20:55",
    system: true,
    text: "marrow is now in game"
  }, {
    time: "20:58",
    user: {
      name: "zk-admin",
      country: "US",
      admin: true
    },
    text: "server restart at 23:00 UTC, matches in progress will finish"
  }, {
    time: "21:01",
    emote: true,
    user: {
      name: "pell"
    },
    text: "is already queuing"
  }, {
    time: "21:02",
    user: {
      name: "hexed",
      clan: "ZKF",
      country: "US"
    },
    text: "Shadowfury hosted, room is open — 11/16 and we need people who can actually hold a flank instead of feeding their com in the first five minutes"
  }, {
    time: "21:06",
    ring: true,
    user: {
      name: "quantum",
      clan: "ZKF",
      country: "PL"
    },
    text: "Shadowfury get in here"
  }],
  debrief: {
    result: "Victory",
    map: "Argent_Strata_1.1",
    mode: "Teams",
    duration: "27:14",
    category: "Team",
    elo: {
      change: 18,
      next: 1842,
      rank: "Sergeant",
      rankup: true,
      prevRankElo: 1750,
      nextRankElo: 1900
    },
    xp: {
      change: 640,
      next: 12480,
      prevLevelXp: 9000,
      nextLevelXp: 16000,
      levelUp: false,
      level: 41
    },
    awards: [{
      name: "Most damage dealt",
      value: "148,320"
    }, {
      name: "Largest army",
      value: "96 units"
    }, {
      name: "First blood",
      value: "2:41"
    }],
    team: [{
      user: {
        name: "Shadowfury",
        clan: "ZKF",
        country: "DE",
        faction: "machines",
        level: 41
      },
      elo: 1842,
      change: 18,
      win: true
    }, {
      user: {
        name: "quantum",
        clan: "ZKF",
        country: "PL",
        faction: "rising",
        level: 12
      },
      elo: 1521,
      change: 18,
      win: true
    }, {
      user: {
        name: "tinman",
        country: "GB",
        faction: "hegemony",
        level: 27
      },
      elo: 1689,
      change: 18,
      win: true
    }, {
      user: {
        name: "a",
        country: "JP",
        faction: "rising",
        level: 3
      },
      elo: 1005,
      change: 18,
      win: true
    }],
    opponents: [{
      user: {
        name: "hexed",
        clan: "ZKF",
        country: "US",
        faction: "machines",
        level: 33
      },
      elo: 1773,
      change: -17,
      win: false
    }, {
      user: {
        name: "lorelei",
        country: "FR",
        faction: "hegemony",
        level: 19
      },
      elo: 1571,
      change: -17,
      win: false
    }, {
      user: {
        name: "marrow",
        country: "SE",
        faction: "machines",
        level: 44
      },
      elo: 1938,
      change: -17,
      win: false
    }, {
      user: {
        name: "vexatiousmachinist",
        country: "BR",
        faction: "rising",
        level: 8
      },
      elo: 1187,
      change: -17,
      win: false
    }]
  }
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/lobby/data.js", error: String((e && e.message) || e) }); }

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
