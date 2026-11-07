// hold.js -- a finger held still on an element: how a finger opens the
// Items list's menus.
//
// iOS Safari fires no 'contextmenu' for a finger held on an element, so on
// an iPad the Items list's row menu (Zoom to item, Properties, Delete) had
// no way in at all, and the heading menu (Collapse all / Expand all) would
// have had none either. A finger -- or a pen -- resting LONG_PRESS_MS within
// TAP_SLOP of where it landed is the right mouse button, exactly as on the
// sheet (js/tools/controller.js: the same two numbers, imported, not
// copied). A mouse and a trackpad keep their own 'contextmenu' (right-click,
// two-finger click): this listens to fingers and pens only.
//
// The hold is called off by: a move of more than the slop (a scroll
// starting), the finger lifting first (a tap: its click goes through, so the
// heading still folds and the row still selects), pointercancel (the browser
// took the touch for a scroll), a second finger anywhere, and the element
// leaving the page (the list was rebuilt under the finger).
//
// When it fires, the click the browser makes of the LIFT is swallowed --
// that click only: the first one within LIFT_CLICK_MS of the lift, at the
// lift's point, and not one after a new press. Without that the lift would
// fold the heading he held, select the row, or press whatever the menu had
// put under his finger.
//
// Hold or tap is decided by how long the finger was DOWN, and the events
// say that themselves (their timeStamps); the timer only says it sooner.
// So a press as long as a hold is never a tap: one that slid a little past
// the slop and lifted without the browser taking it for a scroll opens no
// menu, and its click is swallowed too -- it does not fold the heading or
// select the row. And a tap is never a hold: when the page was busy as the
// finger lifted, the timer can run before the queued lift, and the menu it
// opened is taken back (onTakeBack) and the tap's click goes through. (A
// hold whose timer the busy page had not run yet opens on the lift.)
//
// Nothing here is the DOM's beyond addEventListener on the element and its
// document, so tests/heading-menu.mjs drives it with plain objects and a
// clock of its own.
import { LONG_PRESS_MS, TAP_SLOP } from '../tools/controller.js';

export { LONG_PRESS_MS, TAP_SLOP };
/** How long after a held finger lifts its synthesized click may arrive. */
export const LIFT_CLICK_MS = 350;
/** How far off the finger a menu opened by a hold is drawn. */
export const MENU_OFFSET = 12;

const FINGERS = new Set(['touch', 'pen']);

/**
 * Watch `el` for a finger held still. `onHold({clientX, clientY,
 * pointerType})` is called once per hold, with the finger still down (or,
 * when a busy page ran the timer late, on its lift); `onTakeBack()` when a
 * hold that fired turns out, by the lift's own time, to have been a tap.
 * Returns { busy, cancel, dispose }: busy() is true from a finger's press
 * until its lift's click has been dealt with -- the time in which a
 * 'contextmenu' (Chrome and Android send one for a held finger) is the
 * hold's, not a second menu.
 */
export function holdGesture(el, {
  onHold, onTakeBack, ms = LONG_PRESS_MS, slop = TAP_SLOP, liftMs = LIFT_CLICK_MS, clock = globalThis,
} = {}) {
  const doc = el.ownerDocument || globalThis.document;
  const on = (type, fn) => doc.addEventListener(type, fn, true);
  const off = (type, fn) => doc.removeEventListener(type, fn, true);
  // { id, type, x, y, lastX, lastY, t0, timer, fired, drifted, due }
  let press = null;
  let swallow = null;  // { x, y, timer, held }
  let vetoId = null;   // a second finger's press: it starts no hold of its own

  function endPress() {
    if (!press) return;
    if (press.timer) clock.clearTimeout(press.timer);
    press = null;
    off('pointermove', onMove);
    off('pointerup', onLift);
    off('pointercancel', onLift);
    off('pointerdown', onOther);
  }

  function endSwallow() {
    if (!swallow) return;
    clock.clearTimeout(swallow.timer);
    swallow = null;
    off('click', onClick);
    off('pointerdown', onNextPress);
  }

  function onDown(ev) {
    const vetoed = vetoId !== null && ev.pointerId === vetoId;
    vetoId = null;
    if (vetoed) return;
    if (!FINGERS.has(ev.pointerType) || (ev.button ?? 0) !== 0 || ev.isPrimary === false) return;
    endPress();
    endSwallow();
    const x = Number(ev.clientX) || 0;
    const y = Number(ev.clientY) || 0;
    press = {
      id: ev.pointerId, type: ev.pointerType, x, y, lastX: x, lastY: y,
      // (0 is no time: an event made without one)
      t0: Number.isFinite(ev.timeStamp) && ev.timeStamp > 0 ? ev.timeStamp : null,
      timer: null, fired: false, drifted: false, due: false,
    };
    press.timer = clock.setTimeout(fire, ms);
    on('pointermove', onMove);
    on('pointerup', onLift);
    on('pointercancel', onLift);
    on('pointerdown', onOther);
  }

  function fire() {
    if (!press) return;
    press.timer = null;
    press.due = true;
    // Slid past the slop: no menu -- but it has lasted a hold (onLift).
    if (press.drifted) return;
    // Rebuilt under the finger: what it was held on is gone.
    if (el.isConnected === false) { endPress(); return; }
    press.fired = true;
    onHold?.({ clientX: press.lastX, clientY: press.lastY, pointerType: press.type });
  }

  function onMove(ev) {
    if (!press || ev.pointerId !== press.id) return;
    if (Number.isFinite(ev.clientX)) press.lastX = ev.clientX;
    if (Number.isFinite(ev.clientY)) press.lastY = ev.clientY;
    if (!press.fired && Math.hypot(press.lastX - press.x, press.lastY - press.y) > slop) {
      // No hold any more (a scroll starting, a finger that wandered), but
      // its lift is still watched: how long it was down says tap or not.
      press.drifted = true;
      off('pointermove', onMove);
    }
  }

  function onLift(ev) {
    if (!press || ev.pointerId !== press.id) return;
    const { fired, drifted, due, t0, type } = press;
    // pointercancel carries no point worth trusting; the last move does.
    const x = ev.type === 'pointerup' && Number.isFinite(ev.clientX) ? ev.clientX : press.lastX;
    const y = ev.type === 'pointerup' && Number.isFinite(ev.clientY) ? ev.clientY : press.lastY;
    endPress();
    // How long the finger was down, by the events' own clock: a lift
    // handled late, behind a busy page, still says when it happened. (No
    // timeStamps: the timer's word.)
    const held = t0 !== null && Number.isFinite(ev.timeStamp) && ev.timeStamp >= t0 ? ev.timeStamp - t0 : null;
    const long = held === null ? due : held >= ms;
    if (fired && !long) {
      // The timer ran before the queued lift of a TAP: take the menu back,
      // and the tap's click is its own.
      onTakeBack?.();
      return;
    }
    // A slide the browser took for a scroll makes no click to swallow.
    if (!long || (drifted && ev.type !== 'pointerup')) return;
    let opened = fired;
    if (!fired && !drifted && ev.type === 'pointerup' && el.isConnected !== false) {
      // A hold the busy page had not got to yet: it opens now.
      opened = true;
      onHold?.({ clientX: x, clientY: y, pointerType: type });
    }
    swallow = { x, y, timer: clock.setTimeout(endSwallow, liftMs), held: opened };
    on('click', onClick);
    on('pointerdown', onNextPress);
  }

  // A second finger, anywhere: two fingers are a pinch or a scroll, not a
  // hold. (The document hears it before `el` does, so its own press on `el`
  // is told not to start one.)
  function onOther(ev) {
    if (!press || ev.pointerId === press.id) return;
    endPress();
    // For this one event only: the same id pressed again later is a press.
    vetoId = ev.pointerId;
    clock.setTimeout(() => { vetoId = null; }, 0);
  }

  function onClick(ev) {
    if (!swallow) return;
    const near = !Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)
      || Math.hypot(ev.clientX - swallow.x, ev.clientY - swallow.y) <= 2 * slop;
    if (!near) return;
    ev.preventDefault?.();
    ev.stopPropagation?.();
    ev.stopImmediatePropagation?.();
    endSwallow();
  }

  // A new press after the lift: the next click is that press's own.
  function onNextPress() { endSwallow(); }

  el.addEventListener('pointerdown', onDown);
  return {
    // (A press that slid off is no hold: a 'contextmenu' the browser makes
    // of it is a menu of its own.)
    busy: () => (!!press && !press.drifted) || !!swallow?.held,
    cancel: () => { endPress(); endSwallow(); },
    dispose: () => { endPress(); endSwallow(); el.removeEventListener('pointerdown', onDown); },
  };
}

/**
 * Where a menu of w x h goes for a press at `at` in a vw x vh window: past
 * the point (right of it, below it), or before it on an axis where that
 * does not fit, and on screen whatever happens. A finger's or a pen's menu
 * is drawn MENU_OFFSET off the point, so the lift cannot land on its first
 * entry; a mouse's opens at the pointer, as a desktop menu does (and, as
 * Qt's does, the other way where it would run off the edge).
 */
export function menuPlace(at, w, h, vw, vh, {
  offset = FINGERS.has(at?.pointerType) ? MENU_OFFSET : 0, margin = 8,
} = {}) {
  const axis = (p, size, room) => {
    if (p + offset + size <= room - margin) return p + offset;
    if (p - offset - size >= margin) return p - offset - size;
    return Math.max(margin, Math.min(p + offset, room - size - margin));
  };
  return {
    left: axis(Number(at?.clientX) || 0, w, vw),
    top: axis(Number(at?.clientY) || 0, h, vh),
  };
}
