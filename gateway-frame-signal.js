// gateway-frame-signal.js
// ---------------------------------------------------------------------------
// Framed-gateway recovery signal (2026-09-13)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// gateway.html is normally the TOP-LEVEL document (or a Buddy Desktop window).
// It is loaded inside an IFRAME in exactly one situation that matters: the
// platform's one-time-token handoff endpoint rejected the handoff and answered
// with a 302 to gateway.html?error=...&error_description=...&returnUrl=...
// (OAuthApiController.BuildErrorRedirect). The most common rejection is
// OneTimeTokenFailure.AlreadyUsed -- the same one-time sign-in token submitted a
// second time (confirmed live incidents 2026-09-12/13, volunteer tester
// "JacobKubakowski", gaps 23s/46s/96s/157s after first consumption).
//
// The portal (portal.js) is documented as having a "gateway bounce guard for
// iframe sign-in failures" -- but for a CROSS-ORIGIN iframe it cannot see this
// at all:
//   * portal.js:1504-1533 reads iframe.contentWindow.location directly; that
//     throws for a cross-origin frame, so the frame is flagged cross-origin.
//   * The fallback at portal.js:1880-1888 only matches when the iframe's src
//     ATTRIBUTE contains gateway.html -- an in-frame redirect never changes the
//     src attribute, so it never matches.
//   * portal.js:2021-2102 can only react if the framed page posts a message.
//     gateway.html itself posts nothing (gateway.js has no postMessage call).
//
// Net effect before this file: the AlreadyUsed rejection stranded the user on
// the gateway's error page INSIDE the iframe -- no whole-page recovery, no
// visible bounce, and the spent token URL left as the iframe's src attribute
// and document URL (so any frame reload / history traversal re-submitted a
// token that can never succeed again). Nothing about it reached the incident
// store, so a volunteer tester's failure was completely invisible.
//
// WHAT IT DOES
//   1. Emits always-on telemetry (reuses the existing frontend-error pipeline
//      from gateway-shared.js -> POST api/FrontendError/log -> incident store),
//      so a framed gateway load is now a durable, queryable signal.
//   2. Posts the gateway's own path+query to its parent, which is portal.html on
//      this same origin. That is the exact message shape portal.js's postMessage
//      handler already consumes (portal.js:2067 Format 3 / 2083-2102), so the
//      portal performs its existing, RATE-LIMITED whole-page bounce to
//      gateway.html (redirectToGatewayWithLoopGuard, portal.js:130-171). The
//      user lands on the real, legible gateway error page with its Try Again
//      action, and the trapped frame holding a spent token URL is destroyed.
//
// Same-origin only: the targetOrigin is this page's own origin, and portal.js
// independently rejects any message whose origin is not its own. A gateway
// framed by some other page leaks nothing and changes nothing.
//
// LOAD-ORDER DEPENDENCY (do not move this below gateway.js's DOMContentLoaded work):
// gateway.js STRIPS `error`/`error_description` from its own URL via
// history.replaceState in its DOMContentLoaded handler (gateway.js:3781-3789). This
// script must therefore read location.search during parse, before any
// DOMContentLoaded handler runs -- it does, as a classic script at the end of
// <body>. If it is ever moved to defer/async/module loading, or the strip is moved
// to parse time, the reported path silently loses the rejection reason and the
// bounce degrades to a bare gateway.html. Keep it a plain synchronous <script>.
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  var FRAME_MESSAGE_TYPE = 'gateway-framed';
  var DIAGNOSTIC_TYPE = 'FramedGatewayLoaded';

  try {
    if (typeof window === 'undefined' || !window.location) {
      return;
    }

    // Top-level gateway (normal browser sign-in, Buddy Desktop window, OAuth
    // popup) is already the page the user should be looking at. Nothing to do.
    if (window.parent === window) {
      return;
    }

    var location = window.location;
    var search = location.search || '';
    var path = (location.pathname || '') + search;
    var hasErrorParam = search.indexOf('error=') !== -1;

    // 1. Durable telemetry FIRST (flush before the parent navigates us away).
    try {
      if (typeof bufferFrontendError === 'function') {
        bufferFrontendError({
          Type: DIAGNOSTIC_TYPE,
          // `firstPartyCookies` (renamed from `cookieEnabled`, 2026-09-16): navigator.cookieEnabled
          // reports FIRST-PARTY availability only and is `true` in every browser that blocks
          // third-party cookies -- the exact condition this telemetry exists to identify. The old
          // name read as evidence against the failure it was added to detect. Same rename already
          // applied in portal.js; one name for one measurement across the whole stream.
          // `embeddedWebview`/`ua` come from gateway-shared.js, loaded before this script.
          Message: 'Gateway loaded inside a frame; path=' + (location.pathname || '') +
            ' | hasErrorParam=' + hasErrorParam +
            ' | firstPartyCookies=' + (typeof navigator !== 'undefined' ? navigator.cookieEnabled : 'unknown') +
            ' | embeddedWebview=' + (typeof describeEmbeddedWebview === 'function'
              ? describeEmbeddedWebview(typeof describeUserAgent === 'function' ? describeUserAgent() : '')
              : 'unknown') +
            ' | ua=' + (typeof describeUserAgent === 'function' ? describeUserAgent() : ''),
          Source: 'gateway-frame-signal.js',
          Timestamp: new Date().toISOString()
        });
        // bufferFrontendError schedules a delayed send; the parent's bounce can
        // tear this frame down first, so flush now (sendBeacon-based, survives
        // the frame being destroyed).
        if (typeof sendFrontendErrors === 'function') {
          sendFrontendErrors();
        }
      }
    } catch (e) { /* telemetry must never break recovery */ }

    // 2. Ask the parent portal to run its own whole-page bounce.
    try {
      if (typeof window.postMessage === 'function' && location.origin) {
        window.postMessage(
          { type: FRAME_MESSAGE_TYPE, path: path, url: path, hasError: hasErrorParam },
          location.origin
        );
      }
    } catch (e) { /* cross-origin parent -> nothing we can do, and nothing lost */ }
  } catch (e) {
    // A recovery signal must never throw.
  }
})();
