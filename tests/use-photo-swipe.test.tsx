// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePhotoSwipe } from "@/app/components/usePhotoSwipe";

let root: Root;
let host: HTMLDivElement;
let photo: HTMLButtonElement;
const previous = vi.fn();
const next = vi.fn();
const open = vi.fn();
const interact = vi.fn();

function Harness({ enabled = true, onNext = next }: { enabled?: boolean; onNext?: () => void }) {
  const swipe = usePhotoSwipe({ enabled, onPrevious: previous, onNext, onInteraction: interact });
  return createElement("button", { ...swipe, onClick: open }, "Photo");
}
function touch(type: string, points: [number, number][], ended: [number, number][] = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = (items: [number, number][]) => items.map(([clientX, clientY], identifier) => ({ identifier, clientX, clientY }));
  Object.defineProperties(event, { touches: { value: list(points) }, changedTouches: { value: list(ended) } });
  act(() => photo.dispatchEvent(event));
  return event;
}
function swipe(from: [number, number], to: [number, number]) {
  touch("touchstart", [from]);
  const move = touch("touchmove", [to]);
  touch("touchend", [], [to]);
  return move;
}
function click(detail = 1) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, detail });
  act(() => photo.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  photo = host.querySelector("button")!;
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("photo swipe gestures", () => {
  it("browses once per deliberate horizontal gesture without preventing native touch behavior", () => {
    expect(swipe([200, 100], [100, 104]).defaultPrevented).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
    expect(click().defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    swipe([100, 100], [200, 103]);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(interact).toHaveBeenCalledTimes(2);
  });

  it("allows vertical scrolling and ignores diagonal or short gestures", () => {
    expect(swipe([200, 100], [195, 250]).defaultPrevented).toBe(false);
    swipe([200, 100], [135, 150]);
    swipe([200, 100], [170, 100]);
    expect(previous).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
    expect(click().defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps a gesture that began vertically vertical even if it ends horizontally", () => {
    touch("touchstart", [[200, 100]]); touch("touchmove", [[195, 150]]);
    touch("touchend", [], [[50, 180]]);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows taps and keyboard activation even after a suppressed touch click", () => {
    swipe([200, 100], [100, 100]);
    expect(click(0).defaultPrevented).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(click().defaultPrevented).toBe(true);
    touch("touchstart", [[100, 100]]); touch("touchend", [], [[102, 103]]);
    expect(click().defaultPrevented).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("does not change photos during pinch, cancellation or rotation", () => {
    touch("touchstart", [[200, 100]]); touch("touchmove", [[100, 100], [250, 100]]);
    touch("touchend", [], [[100, 100]]);
    touch("touchstart", [[200, 100]]); touch("touchmove", [[100, 100]]); touch("touchcancel", []);
    touch("touchend", [], [[100, 100]]);
    touch("touchstart", [[200, 100]]); act(() => window.dispatchEvent(new Event("resize"))); touch("touchend", [], [[100, 100]]);
    expect(previous).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
  });

  it("uses current callbacks and respects disabled navigation", () => {
    const updated = vi.fn();
    act(() => root.render(createElement(Harness, { onNext: updated })));
    swipe([200, 100], [100, 100]);
    expect(updated).toHaveBeenCalledTimes(1); expect(next).not.toHaveBeenCalled();
    act(() => root.render(createElement(Harness, { enabled: false, onNext: updated })));
    swipe([200, 100], [100, 100]);
    expect(updated).toHaveBeenCalledTimes(1);
  });
});
