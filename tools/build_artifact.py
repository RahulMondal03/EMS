#!/usr/bin/env python3
"""Bundle the VoltGrid multi-page app into ONE self-contained HTML file.

The app in `ems 9/` is 19 separate HTML pages that share CSS, a localStorage
data store (js/data.js) and navigate with plain links / `location.href`.
A single-file "app artifact" can't serve separate pages, so this script:

  1. inlines every page's CSS <link> and <script src> into its own HTML,
  2. rewrites browser APIs the pages use (location.*, localStorage,
     sessionStorage, confirm) to a small `VG` shim,
  3. embeds every page as a string in a shell document that renders the
     current page in an <iframe srcdoc> and virtualises navigation, and
  4. drops the Google-Fonts links (blocked by the artifact CSP) in favour
     of a system font stack.

Data still persists: the shim proxies the store to the shell window, which
uses real localStorage/sessionStorage when available and an in-memory
fallback when not, so the demo works even in a storage-blocked sandbox.

Usage:  python3 tools/build_artifact.py   ->  dist/voltgrid.html
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "ems 9"
OUT = ROOT / "dist" / "voltgrid.html"

PAGES = [
    "index.html",
    "customer/login.html", "customer/register.html", "customer/dashboard.html",
    "customer/viewPayBill.html", "customer/payment.html", "customer/cardDetails.html",
    "customer/paymentSuccess.html", "customer/registerComplaint.html",
    "customer/complaintStatus.html",
    "employee/login.html", "employee/dashboard.html", "employee/customerLookup.html",
    "employee/complaintDetails.html", "employee/updateStatus.html",
    "admin/dashboard.html", "admin/complaintManagement.html", "admin/billing.html",
    "admin/customerManagement.html", "admin/employeeManagement.html",
    "admin/policyManagement.html",
]

# ---------------------------------------------------------------- JS shim ---
# Injected at the top of <head> of every embedded page. Provides VG.loc
# (virtual location), VG.ls / VG.ss (storage proxied to the shell) and
# VG.confirm, and intercepts link clicks so navigation stays inside the
# artifact. The page transform below rewrites the page code to use it.
SHIM = """
window.VG = (function () {
  var P = window.parent;
  var current = P.VGNAV.current;                     // e.g. "admin/billing.html?x=1"
  var qi = current.indexOf("?");
  var path = qi < 0 ? current : current.slice(0, qi);
  var search = qi < 0 ? "" : current.slice(qi);

  /* Resolve a page-relative href ("../admin/billing.html?x=1") against the
     current virtual path. Returns null for links the browser should keep
     (hash anchors, mailto:, tel:, absolute URLs). */
  function resolve(href) {
    if (!href || /^(https?:|mailto:|tel:|javascript:|#)/.test(href)) return null;
    var hq = href.indexOf("?");
    var hp = hq < 0 ? href : href.slice(0, hq);
    var hs = hq < 0 ? "" : href.slice(hq);
    var parts = path.split("/").slice(0, -1).concat(hp.split("/"));
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === "..") out.pop();
      else if (p !== "." && p !== "") out.push(p);
    }
    return out.join("/") + hs;
  }

  var loc = {
    get pathname() { return "/" + path; },
    get search()   { return search; },
    get href()     { return path + search; },
    set href(v)    { var r = resolve(v); if (r !== null) P.VGNAV.go(r); },
    reload: function () { P.VGNAV.go(current); },
  };

  /* Keep every in-app link inside the artifact. */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var r = resolve(a.getAttribute("href"));
    if (r === null) return;
    e.preventDefault();
    P.VGNAV.go(r);
  }, true);

  /* Some embedded viewers suppress modal dialogs: confirm() then returns
     false instantly. Treat an instant "no" as consent so the demo's
     delete buttons still work everywhere. */
  function confirmShim(msg) {
    var t = Date.now();
    var ok = window.confirm(msg);
    return (!ok && Date.now() - t < 40) ? true : ok;
  }

  document.addEventListener("DOMContentLoaded", function () {
    P.VGNAV.pageReady(document.title);
  });

  return { loc: loc, ls: P.VGSTORE.local, ss: P.VGSTORE.session, confirm: confirmShim };
})();
"""

GOOGLE_FONT_LINK = re.compile(r'\s*<link[^>]*fonts\.googleapis\.com[^>]*/?>', re.I)
CSS_LINK = re.compile(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', re.I)
SCRIPT_SRC = re.compile(r'<script\s+src="([^"]+)"\s*>\s*</script>', re.I)
SCRIPT_INLINE = re.compile(r'(<script>)(.*?)(</script>)', re.S | re.I)


def transform_js(js: str) -> str:
    """Point the page code at the VG shim instead of the real browser APIs."""
    js = re.sub(r'(?<![\w.$])location\.', 'VG.loc.', js)
    js = re.sub(r'(?<![\w.$])localStorage\b', 'VG.ls', js)
    js = re.sub(r'(?<![\w.$])sessionStorage\b', 'VG.ss', js)
    js = re.sub(r'(?<![\w.$])confirm\(', 'VG.confirm(', js)
    return js


def build_page(rel: str) -> str:
    page_dir = (SRC / rel).parent
    html = (SRC / rel).read_text(encoding="utf-8")

    html = GOOGLE_FONT_LINK.sub("", html)
    html = re.sub(r'\s*<link[^>]*rel="preconnect"[^>]*/?>', "", html)

    def inline_css(m):
        css = (page_dir / m.group(1)).resolve().read_text(encoding="utf-8")
        # Google Fonts never load inside the artifact CSP -> system stacks.
        css = css.replace('"Sora", sans-serif',
                          '"Sora", "Avenir Next", "Trebuchet MS", system-ui, sans-serif')
        css = css.replace('"Inter", sans-serif',
                          '"Inter", system-ui, "Segoe UI", -apple-system, sans-serif')
        return "<style>\n" + css + "\n</style>"

    html = CSS_LINK.sub(inline_css, html)

    def inline_js(m):
        js = (page_dir / m.group(1)).resolve().read_text(encoding="utf-8")
        return "<script>\n" + js + "\n</script>"

    html = SCRIPT_SRC.sub(inline_js, html)
    html = SCRIPT_INLINE.sub(lambda m: m.group(1) + transform_js(m.group(2)) + m.group(3), html)

    # The shim must run before any page script.
    html = re.sub(r'(<head[^>]*>)', r'\1<script>' + SHIM + '</script>', html, count=1)
    return html


def main():
    pages = {rel: build_page(rel) for rel in PAGES}
    # `</` would terminate the shell's own <script> block early.
    pages_json = json.dumps(pages, ensure_ascii=False).replace("</", "<\\/")

    shell = (ROOT / "tools" / "shell.html").read_text(encoding="utf-8")
    out = shell.replace("/*__PAGES_JSON__*/null", pages_json)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB, {len(pages)} pages)")


if __name__ == "__main__":
    main()
