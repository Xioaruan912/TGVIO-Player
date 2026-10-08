import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
const baseCss = source("styles/base.css");
const motionCss = source("styles/motion.css");
const glassCss = source("styles/glass.css");
const styleEntry = source("style.css");
const feed = source("feed.ts");
const ui = source("ui.ts");
const fx = source("components/fx.ts");
const feedCss = source("styles/feed.css");
const overlayCss = source("styles/overlay.css");
const largeCss = source("styles/large.css");
const shellCss = source("styles/shell.css");
const allCss = readdirSync(new URL("../src/styles/", import.meta.url)).map((name) => source("styles/" + name)).join("\n");
const rules = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap(([, selectors, body]) => selectors.split(",").map((selector) => ({ selector: selector.trim(), body })));
const body = (css, selector) => rules(css).filter((rule) => rule.selector === selector).map((rule) => rule.body).join("\n");

/* Design tokens are the single source of truth, so the contrast contract is
   checked against the token values themselves rather than a frozen hex.
   var() indirection is followed, so an alias like --accent: var(--primary) still
   yields a real colour for the ratio maths. */
const tokenTable = (css) => {
  const declared = Object.fromEntries(
    [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)]
      .map(([, name, value]) => [name, value.trim().replace(/\s+/g, " ")]));
  const resolve = (name, depth = 0) => {
    const value = declared[name];
    if (value === undefined || depth > 4) return value;
    const reference = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value);
    return reference ? resolve(reference[1].slice(2), depth + 1) : value;
  };
  return Object.fromEntries(Object.keys(declared).map((name) => [name, resolve(name)]));
};
const channel = (value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((index) => channel(parseInt(hex.slice(index, index + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const stops = (gradient) => [...gradient.matchAll(/#[0-9a-f]{6}/gi)].map(([hex]) => hex.toLowerCase());
const tokens = tokenTable(baseCss);

test("12px metadata keeps WCAG AA contrast on every surface it sits on", () => {
  for (const surface of ["bg", "surface", "surface-soft", "surface-raised"]) {
    const ratio = contrast(tokens["text-muted"], tokens[surface]);
    assert.ok(ratio >= 4.5, `--text-muted on --${surface} is ${ratio.toFixed(2)}:1`);
  }
  assert.ok(contrast(tokens["text-secondary"], tokens["bg"]) >= 4.5, "secondary text on the page background");
  // The light violet is used as ink (active labels, section headings) on dark surfaces.
  for (const surface of ["bg", "surface", "surface-raised"]) {
    assert.ok(contrast(tokens["primary"], tokens[surface]) >= 4.5, `--primary as ink on --${surface}`);
  }
  assert.ok(contrast("#ffffff", tokens["danger-fill"]) >= 4.5, "white on the filled danger action");
});

test("white ink clears AA on every stop of the accent gradient", () => {
  // A label on a gradient is only as legible as its weakest stop; axe cannot evaluate
  // gradient backgrounds, so the declared stops are checked instead.
  const accent = stops(tokens["accent-fill"]);
  assert.ok(accent.length >= 3, "the accent gradient declares its stops");
  for (const stop of accent) {
    const ratio = contrast(tokens["accent-ink"], stop);
    assert.ok(ratio >= 4.5, `--accent-ink on accent stop ${stop} is ${ratio.toFixed(2)}:1`);
  }
});

test("gradient headings stay readable and degrade to a visible colour", () => {
  for (const stop of stops(tokens["heading-ink"])) {
    for (const surface of ["bg", "surface"]) {
      const ratio = contrast(stop, tokens[surface]);
      assert.ok(ratio >= 4.5, `heading stop ${stop} on --${surface} is ${ratio.toFixed(2)}:1`);
    }
  }
  // Clipped gradient text must never be able to end up invisible.
  assert.match(glassCss, /@supports \(background-clip: text\)/);
  assert.match(glassCss, /\.browse-title,[\s\S]*?\{\s*color: var\(--primary-bright\);\s*\}/);
  assert.match(glassCss, /-webkit-text-fill-color: transparent/);
});

test("the palette is dark and never falls back to a light surface", () => {
  assert.ok(luminance(tokens["bg"]) < 0.05, `--bg luminance ${luminance(tokens["bg"]).toFixed(3)}`);
  assert.match(baseCss, /color-scheme:\s*dark/);
  for (const surface of ["bg", "bg-deep", "surface", "surface-raised", "surface-sunken", "surface-soft", "media-bg", "privacy-cover"]) {
    assert.ok(luminance(tokens[surface]) < 0.08, `--${surface} is not dark`);
  }
});

test("the accent ink is the only label colour on an accent fill", () => {
  const primaryRule = rules(glassCss).filter((rule) => rule.body.includes("background-image: var(--accent-fill)"));
  for (const selector of [".transport-play", ".large-play", ".login-submit", ".library-selection > .library-button:first-child"]) {
    const rule = primaryRule.find((candidate) => candidate.selector === selector);
    assert.ok(rule, "accent fill covers " + selector);
    assert.match(rule.body, /color:\s*var\(--accent-ink\)/, selector);
  }
  assert.match(body(shellCss, ".desktop-nav .nav-btn.active"), /color:\s*var\(--accent-ink\)/);
});

test("the motion scale is spring based and collapses under reduced motion", () => {
  assert.match(motionCss, /--ease-spring:\s*linear\(0 0%/);
  assert.match(motionCss, /--ease-spring-soft:\s*linear\(0 0%/);
  for (const token of ["--dur-instant: 90ms", "--dur-fast: 180ms", "--dur-base: 280ms", "--dur-slow: 420ms", "--dur-cinema: 560ms"]) {
    assert.ok(motionCss.includes(token), token);
  }
  const reduced = motionCss.slice(motionCss.indexOf("@media (prefers-reduced-motion: reduce)"));
  for (const token of ["--ease-spring: linear;", "--ease-spring-soft: linear;", "--ease-gentle: linear;"]) {
    assert.ok(reduced.includes(token), "reduced motion must neutralise " + token);
  }
  assert.match(reduced, /\.fx-burst, \.fx-ripple \{ display: none; \}/, "decorative effects disappear");
  assert.match(fx, /if \(!motionAllowed\(\)/, "effects are not even created under reduced motion");
  assert.match(styleEntry, /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  // Motion and the glass layer come after the component shorthands they override.
  assert.ok(styleEntry.indexOf("motion.css") > styleEntry.indexOf("settings.css"));
  assert.ok(styleEntry.indexOf("glass.css") > styleEntry.indexOf("motion.css"));
});

test("entrances never leave a transform behind", () => {
  // A transform kept by `both` would make a page the containing block of its fixed
  // descendants (menus, the scrub bubble), so time-based entrances fill backwards only.
  for (const [css, selector] of [[motionCss, ".browse-page"], [motionCss, ".cover-grid > .cover-tile"], [overlayCss, ".clip-info.is-entering"], [largeCss, ".large-controls"]]) {
    const rule = body(css, selector);
    assert.match(rule, /animation:[^;]*backwards/, selector);
    assert.doesNotMatch(rule, /animation:[^;]*\bboth\b/, selector);
  }
});

test("glass blur stays off the surfaces that must not become a containing block", () => {
  const blurred = rules(glassCss).filter((rule) => /backdrop-filter/.test(rule.body)).map((rule) => rule.selector);
  assert.ok(blurred.includes(".bottom-nav"), "the dock is glass");
  // The feed header floats on the picture and must never blur the frame; the sheet card
  // hosts fixed-position content and its backdrop already blurs the page.
  for (const selector of [".topbar", ".sheet-card", ".app-shell", ".browse-page", ".large-player"]) {
    assert.ok(!blurred.includes(selector), selector + " must not take backdrop-filter");
  }
});

test("the unfilled seek track stays a perceivable control boundary", () => {
  const ratio = contrast(tokens["track"], tokens["surface"]);
  assert.ok(ratio >= 3, `--track on --surface is ${ratio.toFixed(2)}:1`);
  assert.match(body(overlayCss, ".seek::-webkit-slider-runnable-track"), /var\(--track\)/);
  assert.match(body(overlayCss, ".seek::-moz-range-track"), /var\(--track\)/);
});

test("the short feed is a labelled, keyboard-reachable region", () => {
  assert.match(ui, /feed\.setAttribute\("role", "region"\)/);
  assert.match(ui, /feed\.setAttribute\("aria-label", "竖屏视频流"\)/);
  assert.match(ui, /feed\.tabIndex = 0/);
});

test("the primary transport is a round action named by its aria-label", () => {
  const play = body(overlayCss, ".transport-play");
  assert.match(play, /border-radius:\s*50%/);
  const width = Number(play.match(/(?:^|;)\s*width:\s*(\d+)px/)?.[1]);
  const height = Number(play.match(/(?:^|;)\s*height:\s*(\d+)px/)?.[1]);
  assert.ok(width >= 48 && width === height, `round 48px+ target, got ${width}x${height}`);
  assert.match(body(overlayCss, ".transport-label"), /display:\s*none/);
  assert.match(source("components/player-panel.ts"), /playBtn\.setAttribute\("aria-label", label\.textContent\)/);
});

test("poster is decorative; media-loading is the only loading status", () => {
  assert.doesNotMatch(feed, /poster-(?:spinner|label)|poster\.append/);
  assert.match(feed, /poster\.setAttribute\("aria-hidden", "true"\)/);
  assert.equal((feed.match(/setAttribute\("role", "status"\)/g) ?? []).length, 1);
  assert.match(feed, /loading\.append\(ring, loadingLabel\)/);
  assert.doesNotMatch(feedCss, /poster-spinner|poster-label|poster-spin/);
  assert.match(body(feedCss, ".poster"), /pointer-events:\s*none/);
});

test("loading and buffering only restore the poster before a decoded frame", () => {
  for (const state of ["loading", "buffering"]) {
    assert.match(body(feedCss, ".video-page:not(.frame-ready)[data-playback-state=\"" + state + "\"] .poster"), /opacity:\s*1/);
    assert.equal(body(feedCss, ".video-page[data-playback-state=\"" + state + "\"] .poster"), "");
    assert.match(body(feedCss, ".video-page[data-playback-state=\"" + state + "\"] .media-loading"), /opacity:\s*1/);
  }
  const ready = body(feedCss, ".video-page.frame-ready .poster");
  assert.match(ready, /opacity:\s*0/);
  assert.match(ready, /visibility:\s*hidden/);
  assert.match(body(feedCss, ".video-page:not(.is-active) .media-loading"), /visibility:\s*hidden/);
});

test("persistent header and transport are not hidden by inactivity controls", () => {
  for (const css of [overlayCss, largeCss]) {
    assert.doesNotMatch(css, /not\(\.controls-visible\)[^{]*\.(?:topbar|transport-row|action-rail|clip-info|large-topbar|large-controls)/);
  }
  const fn = ui.slice(ui.indexOf("export function setControlsVisible"), ui.indexOf("export function hideIndicator"));
  assert.match(fn, /classList\.toggle\("controls-visible", visible\)/);
  assert.match(fn, /querySelectorAll<HTMLElement>\("\.media-overlay-controls"\)/);
  assert.doesNotMatch(fn, /\.topbar|\.action-rail|\.clip-info/);
});

test("short and long seek are visible with dedicated 48px touch rows", () => {
  for (const [css, selector] of [[overlayCss, ".seek"], [largeCss, ".large-progress"], [largeCss, ".large-seek"]]) {
    const height = Number(body(css, selector).match(/(?:^|;)\s*height:\s*(\d+)px/)?.[1]);
    assert.ok(height >= 48, selector + ": height " + height);
  }
  assert.doesNotMatch(body(overlayCss, ".progress-row"), /display:\s*none/);
  assert.match(body(largeCss, ".large-controls"), /display:\s*grid/);
  assert.match(body(largeCss, ".large-action-row"), /flex-wrap:\s*wrap/);
});

test("privacy lock uses opaque cover rather than revealing a blurred frame", () => {
  assert.match(baseCss, /--privacy-cover:\s*#[0-9a-f]{6};/);
  assert.match(body(feedCss, ".app-shell.privacy-locked .video-host"), /visibility:\s*hidden/);
  assert.match(body(feedCss, ".app-shell.privacy-locked .media-stage::after"), /background:\s*var\(--privacy-cover\)/);
});

test("stylesheets never reach a remote origin", () => {
  // Fonts and images ship through the asset pipeline or not at all: a remote origin
  // would leak viewing to a third party and break offline/PWA use.
  assert.doesNotMatch(allCss, /url\(\s*["']?https?:\/\//);
  assert.doesNotMatch(allCss, /@import\s+["']?https?:/);
});

test("the shell only references frontend paths the Player server routes", () => {
  // Authority: `src/tgvio_player/adapters/http/server.py` serves `/`, a static
  // mount on `/assets`, and exactly these root-level files. A reference to
  // anything else resolves to a 404 in production while looking fine locally.
  const routed = ["", "/site.webmanifest", "/apple-touch-icon.png", "/player-icon-192.png", "/player-icon-512.png", "/player-icon.svg"];
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  // `/src/main.ts` is the dev entry; Vite rewrites it into `/assets/` at build
  // time. Every other root-relative reference has to be routable as written.
  const references = [...html.matchAll(/(?:href|src)="([^"]*)"/g)]
    .map(([, value]) => value)
    .filter((value) => value.startsWith("/") && !value.startsWith("/src/"));
  assert.ok(references.includes("/site.webmanifest") && references.includes("/apple-touch-icon.png"), "the shell references its root-level assets");
  for (const reference of references) {
    assert.ok(reference.startsWith("/assets/") || routed.includes(reference), `the Player server does not route ${reference}`);
  }
});

test("the static rail label takes the button's ink, not a fixed light tone", () => {
  // With no hover the rail labels stop being floating tooltips and sit inside the
  // button. On the active item that is the white on the gradient fill.
  const staticBranch = shellCss.slice(shellCss.indexOf("@media (hover: none) and (min-width: 900px)"));
  const label = body(staticBranch, ".desktop-nav .nav-label");
  assert.match(label, /background:\s*none/, "the static label brings no surface of its own");
  assert.match(label, /color:\s*inherit/, "so it has to take the button's ink");
  assert.doesNotMatch(shellCss, /\.desktop-nav \.nav-btn\.active \.nav-label/, "no fixed ink may override the inheritance");
});

test("the long player header floats on the picture instead of owning a grid row", () => {
  const topbar = body(largeCss, ".large-topbar");
  assert.match(topbar, /position:\s*absolute/, "the header is taken out of the flow");
  assert.match(topbar, /inset:\s*0 0 auto/, "the header is pinned to the top of the player");
  assert.match(topbar, /background:\s*var\(--media-scrim-top\)/, "the header paints its own scrim");
  // The floating bar must not steal the picture: only its two controls opt back
  // into pointer input, so a double-tap on the upper frame still seeks.
  assert.match(topbar, /pointer-events:\s*none/);
  for (const selector of [".large-topbar .large-back", ".large-topbar .large-privacy-lock"]) {
    assert.match(body(largeCss, selector), /pointer-events:\s*auto/, selector);
    assert.match(body(largeCss, selector), /background:\s*var\(--glass-control\)/, selector);
  }
  // The feed header floats the same way and also never swallows the picture's input.
  assert.match(body(overlayCss, ".topbar"), /pointer-events:\s*none/);
  assert.match(body(overlayCss, ".topbar > *"), /pointer-events:\s*auto/);
});

test("the media scrims keep their text readable on the brightest frame", () => {
  // The floating chrome owns its scrims, so contrast cannot be checked against a flat
  // token. Composite each declared gradient over pure white and walk the band its
  // text occupies; a scrim that fades out early fails here.
  const parse = (gradient) => [...gradient.matchAll(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)\s+([\d.]+)%/g)]
    .map(([, r, g, b, alpha, at]) => ({ rgb: [+r, +g, +b], alpha: +alpha, at: +at / 100 }));
  const overWhite = (scrim, position) => {
    const index = scrim.findIndex((stop) => stop.at >= position);
    const upper = scrim[index === -1 ? scrim.length - 1 : index];
    const lower = scrim[Math.max(0, (index === -1 ? scrim.length : index) - 1)];
    const span = upper.at - lower.at;
    const mix = span === 0 ? 1 : Math.min(1, Math.max(0, (position - lower.at) / span));
    const alpha = lower.alpha + (upper.alpha - lower.alpha) * mix;
    return lower.rgb.map((value, channelIndex) => Math.round(alpha * (value + (upper.rgb[channelIndex] - value) * mix) + (1 - alpha) * 255));
  };
  const toHex = (rgb) => "#" + rgb.map((value) => value.toString(16).padStart(2, "0")).join("");
  for (const name of ["media-scrim-top", "media-scrim-bottom"]) {
    const scrim = parse(tokens[name]);
    assert.ok(scrim.length >= 2, `--${name} declares parseable stops`);
    for (const position of [0, 0.1, 0.2, 0.3, 0.4, 0.475]) {
      const background = overWhite(scrim, position);
      for (const ink of ["text", "text-muted"]) {
        const ratio = contrast(tokens[ink], toHex(background));
        assert.ok(ratio >= 4.5, `--${ink} on --${name} at ${position * 100}% is ${ratio.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(overWhite(scrim, 1), [255, 255, 255], `--${name} is fully transparent at its far edge`);
  }
});

test("a spinner only turns while the loader it belongs to is on screen", () => {
  // `visibility: hidden` does not stop an animation, and most rings in a full feed sit
  // inside a hidden loader; they must not turn behind an invisible layer.
  const ring = body(feedCss, ".media-loading-ring");
  assert.match(ring, /animation:\s*media-ring-turn/, "the ring keeps its rotation");
  assert.match(ring, /animation-play-state:\s*paused/, "but it is parked until its loader shows");
  const running = body(feedCss, ".video-page[data-playback-state=\"loading\"] .media-loading-ring");
  assert.match(running, /animation-play-state:\s*running/, "only the states that paint the loader spin it");
  for (const host of [".video-page", ".large-player"]) {
    assert.match(
      body(feedCss, `${host}[data-playback-state="buffering"] .media-loading-ring`),
      /animation-play-state:\s*running/,
      `${host} buffering`,
    );
  }
  assert.match(
    body(feedCss, ".video-page:not(.is-active) .media-loading-ring"),
    /animation-play-state:\s*paused/,
    "a placeholder page keeps its ring parked even while buffering",
  );
});

test("the lock cover leaves, so the picture is what animates in", () => {
  // The cover is a pseudo-element that disappears with the class, so it cannot fade
  // out. The reveal is animated instead, on the thing that becomes visible.
  assert.match(feedCss, /@keyframes privacy-reveal\s*\{\s*from\s*\{\s*opacity:\s*0/);
  for (const [css, selector] of [[feedCss, ".app-shell:not(.privacy-locked) .video-host"], [largeCss, ".large-player:not(.privacy-locked) .large-video"]]) {
    const rule = body(css, selector);
    assert.match(rule, /animation:\s*privacy-reveal/, selector);
    assert.match(rule, /var\(--dur-fast\)/, `${selector} stays a short reveal`);
  }
  assert.match(body(feedCss, ".app-shell.privacy-locked .video-host"), /visibility:\s*hidden/);
  assert.match(body(largeCss, ".large-player.privacy-locked .large-video"), /visibility:\s*hidden/);
  assert.doesNotMatch(feedCss, /\.privacy-locked[^{]*\{[^}]*opacity:\s*0/, "the cover is never made translucent");
});

test("long privacy lock also uses an opaque cover", () => {
  assert.match(body(largeCss, ".large-player.privacy-locked .large-video"), /visibility:\s*hidden/);
  assert.match(body(largeCss, ".large-player.privacy-locked .large-stage::after"), /background:\s*var\(--privacy-cover\)/);
});
