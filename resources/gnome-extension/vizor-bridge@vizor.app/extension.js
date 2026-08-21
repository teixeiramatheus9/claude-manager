// Vizor Bridge: gives Vizor the three window primitives Wayland denies to
// normal apps (list/titles, activate, virtual key press). Runs inside the
// compositor, so no RemoteDesktop consent dialog is involved. Strings that
// cross D-Bus carry base64 so titles never fight gdbus quoting.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const BRIDGE_VERSION = '1';

const BRIDGE_IFACE = `
<node>
  <interface name="app.vizor.Bridge">
    <method name="ListWindows"><arg type="s" direction="out" name="windows"/></method>
    <method name="Activate"><arg type="s" direction="in" name="id"/></method>
    <method name="GetTitle"><arg type="s" direction="in" name="id"/><arg type="s" direction="out" name="title"/></method>
    <method name="PressKey"><arg type="s" direction="in" name="combo"/></method>
    <method name="TypeText"><arg type="s" direction="in" name="text"/></method>
    <method name="Version"><arg type="s" direction="out" name="version"/></method>
  </interface>
</node>`;

// X11 keysym values (Clutter uses the same numbering). Only what the
// TERMINALS registry and the reply flow actually press.
const KEYVALS = {
  Next: 0xff56,
  Page_Down: 0xff56,
  Prior: 0xff55,
  Page_Up: 0xff55,
  Tab: 0xff09,
  Return: 0xff0d,
  Down: 0xff54,
  Up: 0xff52,
  Left: 0xff51,
  Right: 0xff53,
  bracketright: 0x5d,
  bracketleft: 0x5b,
};

const MODIFIER_KEYVALS = {
  ctrl: 0xffe3, // Control_L
  shift: 0xffe1, // Shift_L
  alt: 0xffe9, // Alt_L
  super: 0xffeb, // Super_L
};

// X keysym convention: latin-1 maps straight to the codepoint, everything
// else is codepoint | 0x01000000. This is how wtype/ydotool type unicode.
const unicodeKeyval = (codePoint) =>
  codePoint === 0x0a ? KEYVALS.Return : codePoint < 0x100 ? codePoint : 0x01000000 | codePoint;

const encode = (text) => GLib.base64_encode(new TextEncoder().encode(text));
const decode = (b64) => new TextDecoder().decode(GLib.base64_decode(b64));

export default class VizorBridgeExtension extends Extension {
  enable() {
    this._keyboard = null;
    this._dbus = Gio.DBusExportedObject.wrapJSObject(BRIDGE_IFACE, this);
    this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/VizorBridge');
  }

  disable() {
    this._dbus?.unexport();
    this._dbus = null;
    this._keyboard = null;
  }

  _windows() {
    return global
      .get_window_actors()
      .map((actor) => actor.meta_window)
      .filter((window) => window && window.get_window_type() === Meta.WindowType.NORMAL);
  }

  _find(id) {
    return this._windows().find((window) => String(window.get_id()) === String(id)) ?? null;
  }

  ListWindows() {
    const list = this._windows().map((window) => ({
      id: String(window.get_id()),
      wmClass: window.get_wm_class() ?? '',
      appId: window.get_gtk_application_id() ?? window.get_sandboxed_app_id() ?? '',
      title: window.get_title() ?? '',
      focused: window.has_focus(),
    }));
    return encode(JSON.stringify(list));
  }

  Activate(id) {
    const window = this._find(id);
    if (!window) throw new Error(`no window ${id}`);
    window.activate(global.get_current_time());
  }

  GetTitle(id) {
    const window = this._find(id);
    if (!window) throw new Error(`no window ${id}`);
    return encode(window.get_title() ?? '');
  }

  _virtualKeyboard() {
    if (!this._keyboard) {
      const seat = Clutter.get_default_backend().get_default_seat();
      this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }
    return this._keyboard;
  }

  _tap(keyvals) {
    const keyboard = this._virtualKeyboard();
    const now = () => GLib.get_monotonic_time();
    for (const keyval of keyvals) keyboard.notify_keyval(now(), keyval, Clutter.KeyState.PRESSED);
    for (const keyval of [...keyvals].reverse())
      keyboard.notify_keyval(now(), keyval, Clutter.KeyState.RELEASED);
  }

  PressKey(combo) {
    const parts = String(combo).split('+').filter(Boolean);
    const keyName = parts.pop();
    const modifiers = parts.map((name) => {
      const keyval = MODIFIER_KEYVALS[name.toLowerCase()];
      if (!keyval) throw new Error(`unknown modifier ${name}`);
      return keyval;
    });
    const key =
      KEYVALS[keyName] ?? (keyName.length === 1 ? unicodeKeyval(keyName.codePointAt(0)) : null);
    if (!key) throw new Error(`unknown key ${keyName}`);
    this._tap([...modifiers, key]);
  }

  TypeText(textB64) {
    for (const character of decode(textB64)) this._tap([unicodeKeyval(character.codePointAt(0))]);
  }

  Version() {
    return BRIDGE_VERSION;
  }
}
