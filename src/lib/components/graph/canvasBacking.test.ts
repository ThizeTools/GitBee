import { describe, test, expect } from "bun:test";
import { sizeCanvasBacking, type CanvasSizeTarget } from "./canvasBacking";

// Named fake: counts writes to width and height, the calls that reallocate
// a real canvas's backing store.
class RecordingCanvas implements CanvasSizeTarget {
  writes = 0;
  style = { width: "", height: "" };
  private w = 0;
  private h = 0;

  get width(): number { return this.w; }
  set width(v: number) { this.w = v; this.writes++; }
  get height(): number { return this.h; }
  set height(v: number) { this.h = v; this.writes++; }
}

describe("sizeCanvasBacking", () => {
  test("scales the backing store by the device pixel ratio", () => {
    const canvas = new RecordingCanvas();
    sizeCanvasBacking(canvas, 240, 600, 2);
    expect(canvas.width).toBe(480);
    expect(canvas.height).toBe(1200);
    expect(canvas.style.width).toBe("240px");
    expect(canvas.style.height).toBe("600px");
  });

  test("floors fractional backing sizes", () => {
    const canvas = new RecordingCanvas();
    sizeCanvasBacking(canvas, 100.5, 50, 1.5);
    expect(canvas.width).toBe(150);
    expect(canvas.height).toBe(75);
  });

  // Regression: reallocating the backing store on every frame was the scroll
  // cost in graph-loading.md. An unchanged size must not write width or height.
  test("does not reallocate when the size is unchanged", () => {
    const canvas = new RecordingCanvas();
    sizeCanvasBacking(canvas, 240, 600, 2);
    const writesAfterFirst = canvas.writes;
    sizeCanvasBacking(canvas, 240, 600, 2);
    expect(canvas.writes).toBe(writesAfterFirst);
  });

  test("writes only the dimension that changed", () => {
    const canvas = new RecordingCanvas();
    sizeCanvasBacking(canvas, 240, 600, 2);
    const writesAfterFirst = canvas.writes;
    sizeCanvasBacking(canvas, 240, 700, 2);
    expect(canvas.writes).toBe(writesAfterFirst + 1);
    expect(canvas.height).toBe(1400);
  });
});
