// Sizes a canvas's backing store for the device pixel ratio. Pure over a
// structural target, so bun test can drive it with a fake canvas.

// The subset of HTMLCanvasElement this helper writes.
export interface CanvasSizeTarget {
  width: number;
  height: number;
  style: { width: string; height: string };
}

// Setting width or height reallocates and clears the backing store, so each
// property is written only when it changes. WHY: GraphCanvas redraws on every
// animation frame; reallocating each frame was the scroll cost measured in
// graph-loading.md. The renderer clears with clearRect inside save/restore.
//
// Usage: sizeCanvasBacking(canvas, 240, 600, 2) gives a 480x1200 backing store
// shown at 240x600 CSS px.
export function sizeCanvasBacking(
  canvas: CanvasSizeTarget,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): void {
  const backingWidth = Math.floor(cssWidth * dpr);
  const backingHeight = Math.floor(cssHeight * dpr);
  if (canvas.width !== backingWidth) canvas.width = backingWidth;
  if (canvas.height !== backingHeight) canvas.height = backingHeight;
  const styleWidth = `${cssWidth}px`;
  const styleHeight = `${cssHeight}px`;
  if (canvas.style.width !== styleWidth) canvas.style.width = styleWidth;
  if (canvas.style.height !== styleHeight) canvas.style.height = styleHeight;
}
