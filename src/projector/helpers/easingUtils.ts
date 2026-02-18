import TWEEN from "@tweenjs/tween.js";

export const SUPPORTED_EASINGS: string[] = [
  "linear",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "easeInQuart",
  "easeOutQuart",
  "easeInOutQuart",
  "easeInSine",
  "easeOutSine",
  "easeInOutSine",
  "easeInExpo",
  "easeOutExpo",
  "easeInOutExpo",
  "easeInCirc",
  "easeOutCirc",
  "easeInOutCirc",
  "easeInElastic",
  "easeOutElastic",
  "easeInOutElastic",
  "easeInBounce",
  "easeOutBounce",
  "easeInOutBounce",
  "easeInBack",
  "easeOutBack",
  "easeInOutBack",
];

const EASING_MAP: Record<string, (k: number) => number> = {
  linear: TWEEN.Easing.Linear.None,
  easeInQuad: TWEEN.Easing.Quadratic.In,
  easeOutQuad: TWEEN.Easing.Quadratic.Out,
  easeInOutQuad: TWEEN.Easing.Quadratic.InOut,
  easeInCubic: TWEEN.Easing.Cubic.In,
  easeOutCubic: TWEEN.Easing.Cubic.Out,
  easeInOutCubic: TWEEN.Easing.Cubic.InOut,
  easeInQuart: TWEEN.Easing.Quartic.In,
  easeOutQuart: TWEEN.Easing.Quartic.Out,
  easeInOutQuart: TWEEN.Easing.Quartic.InOut,
  easeInSine: TWEEN.Easing.Sinusoidal.In,
  easeOutSine: TWEEN.Easing.Sinusoidal.Out,
  easeInOutSine: TWEEN.Easing.Sinusoidal.InOut,
  easeInExpo: TWEEN.Easing.Exponential.In,
  easeOutExpo: TWEEN.Easing.Exponential.Out,
  easeInOutExpo: TWEEN.Easing.Exponential.InOut,
  easeInCirc: TWEEN.Easing.Circular.In,
  easeOutCirc: TWEEN.Easing.Circular.Out,
  easeInOutCirc: TWEEN.Easing.Circular.InOut,
  easeInElastic: TWEEN.Easing.Elastic.In,
  easeOutElastic: TWEEN.Easing.Elastic.Out,
  easeInOutElastic: TWEEN.Easing.Elastic.InOut,
  easeInBounce: TWEEN.Easing.Bounce.In,
  easeOutBounce: TWEEN.Easing.Bounce.Out,
  easeInOutBounce: TWEEN.Easing.Bounce.InOut,
  easeInBack: TWEEN.Easing.Back.In,
  easeOutBack: TWEEN.Easing.Back.Out,
  easeInOutBack: TWEEN.Easing.Back.InOut,
};

export function resolveEasing(name: unknown): ((k: number) => number) | null {
  if (typeof name !== "string") return null;
  return EASING_MAP[name] || null;
}

type TweenOnUpdate = (current: Record<string, number>) => void;

export function tweenHelper(
  from: Record<string, number>,
  to: Record<string, number>,
  duration: number,
  easing: unknown,
  onUpdate?: TweenOnUpdate
): { tween: unknown; promise: Promise<void> } {
  const dur = typeof duration === "number" && Number.isFinite(duration) && duration > 0
    ? duration
    : 500;

  const easingFn =
    typeof easing === "function"
      ? (easing as (k: number) => number)
      : typeof easing === "string"
        ? resolveEasing(easing) || TWEEN.Easing.Quadratic.InOut
        : TWEEN.Easing.Quadratic.InOut;

  const state = { ...from };
  let resolvePromise: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  const tween = new TWEEN.Tween(state)
    .to(to, dur)
    .easing(easingFn)
    .onUpdate(() => {
      if (typeof onUpdate === "function") onUpdate(state);
    })
    .onComplete(() => resolvePromise())
    .onStop(() => resolvePromise())
    .start();

  return { tween, promise };
}
