#!/usr/bin/env python3
"""Polite, general-purpose web scraper.

Fetches one or more pages, extracts the useful parts (title, meta
description, headings, links, images, word count and anything matching the
CSS selectors you pass), optionally follows same-site links to a limited
depth, and writes the results as JSON, JSON Lines or CSV.

Examples:
    # Scrape one page and print JSON to stdout
    python webscraper.py https://example.com

    # Crawl one link deep (at most 25 pages) and save to a file
    python webscraper.py https://example.com --depth 1 --max-pages 25 -o site.json

    # Grab specific elements. "selector@attr" reads an attribute instead of text.
    python webscraper.py https://example.com -s "h2.title" -s "a.btn@href"

    # CSV, one row per page (format is guessed from the file extension)
    python webscraper.py https://example.com --depth 1 -o pages.csv

The scraper honours robots.txt (including Crawl-delay), identifies itself
with a User-Agent, waits between requests and retries transient failures
with exponential backoff. Only scrape sites whose terms allow it.

Requires Python 3.9+ and two packages:
    pip install requests beautifulsoup4
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
import time
import warnings
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Iterator, Sequence
from urllib.parse import quote, urldefrag, urljoin, urlsplit, urlunsplit

try:
    import requests
    from bs4 import BeautifulSoup, Comment
except ImportError as exc:  # pragma: no cover - depends on the environment
    sys.exit(f"Missing dependency '{exc.name}'. Install with: pip install requests beautifulsoup4")

try:  # lxml is faster and more forgiving; fall back to the stdlib parser.
    import lxml  # noqa: F401

    PARSER = "lxml"
except ImportError:  # pragma: no cover
    PARSER = "html.parser"

try:  # bs4 warns when a tiny document looks like a filename; that is noise here.
    from bs4 import MarkupResemblesLocatorWarning

    warnings.filterwarnings("ignore", category=MarkupResemblesLocatorWarning)
except ImportError:  # pragma: no cover - older bs4
    pass

log = logging.getLogger("webscraper")

DEFAULT_USER_AGENT = "ems-webscraper/1.0 (+https://github.com/rahulmondal03/ems)"
HTML_TYPES = {"text/html", "application/xhtml+xml"}
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_WAIT = 60.0

# Links ending like this are never queued while crawling: they are not pages.
SKIP_EXTENSIONS = (
    ".css", ".js", ".json", ".xml", ".rss", ".ico", ".png", ".jpg", ".jpeg", ".gif",
    ".svg", ".webp", ".bmp", ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z", ".mp3",
    ".mp4", ".avi", ".mov", ".woff", ".woff2", ".ttf", ".eot", ".exe", ".dmg", ".doc",
    ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
)
SELECTOR_RE = re.compile(r"^(?P<css>.+?)@(?P<attr>[A-Za-z_][\w-]*)$")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class Selector:
    """A ``--select`` argument: a CSS selector plus an optional attribute."""

    spec: str
    css: str
    attr: str | None = None


@dataclass
class Page:
    """Everything extracted from one URL (``error`` is set when it failed)."""

    url: str
    depth: int = 0
    final_url: str = ""
    status: int | None = None
    content_type: str = ""
    fetched_at: str = ""
    title: str = ""
    description: str = ""
    headings: list[dict] = field(default_factory=list)
    links: list[dict] = field(default_factory=list)
    images: list[dict] = field(default_factory=list)
    word_count: int = 0
    selections: dict[str, list[str]] = field(default_factory=dict)
    error: str | None = None


@dataclass
class _RobotsGroup:
    agents: list[str] = field(default_factory=list)
    rules: list[tuple[str, bool]] = field(default_factory=list)  # (pattern, allow)
    crawl_delay: float = 0.0


@dataclass
class RobotsRules:
    """The robots.txt rules that apply to us, matched as RFC 9309 describes:
    the longest matching rule wins, Allow wins a tie, "*" is a wildcard and a
    trailing "$" anchors the pattern to the end of the path."""

    rules: list[tuple[str, bool]] = field(default_factory=list)
    crawl_delay: float = 0.0
    disallow_all: bool = False

    @classmethod
    def parse(cls, text: str, user_agent: str) -> RobotsRules:
        """Keep the groups addressed to our User-Agent token, or the "*" groups."""
        token = user_agent.split("/", 1)[0].strip().lower()
        groups: list[_RobotsGroup] = []
        in_agent_lines = False
        for raw_line in text.splitlines():
            line = raw_line.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, value = (part.strip() for part in line.split(":", 1))
            key = key.lower()
            if key == "user-agent":
                if not in_agent_lines:
                    groups.append(_RobotsGroup())
                    in_agent_lines = True
                groups[-1].agents.append(value.lower())
            elif groups:
                in_agent_lines = False
                group = groups[-1]
                if key == "disallow" and value:
                    group.rules.append((value, False))
                elif key == "allow" and value:
                    group.rules.append((value, True))
                elif key == "crawl-delay":
                    try:
                        group.crawl_delay = max(group.crawl_delay, float(value))
                    except ValueError:
                        pass

        def addressed(agent: str) -> bool:
            return agent not in ("", "*") and agent in token

        specific = any(addressed(agent) for group in groups for agent in group.agents)
        chosen = [group for group in groups
                  if (any(addressed(a) for a in group.agents) if specific else "*" in group.agents)]
        return cls(rules=[rule for group in chosen for rule in group.rules],
                   crawl_delay=max((group.crawl_delay for group in chosen), default=0.0))

    def allows(self, url: str) -> bool:
        if self.disallow_all:
            return False
        parts = urlsplit(url)
        path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        best, allowed = -1, True
        for pattern, allow in self.rules:
            if not self._matches(pattern, path):
                continue
            if len(pattern) > best or (len(pattern) == best and allow):
                best, allowed = len(pattern), allow
        return allowed

    @staticmethod
    def _matches(pattern: str, path: str) -> bool:
        anchored = pattern.endswith("$")
        if anchored:
            pattern = pattern[:-1]
        regex = ".*".join(re.escape(part) for part in pattern.split("*"))
        return re.match(regex + ("$" if anchored else ""), path) is not None


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def clean(text: str) -> str:
    """Collapse runs of whitespace into single spaces and trim."""
    return " ".join(text.split())


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_http(url: str) -> bool:
    return urlsplit(url).scheme in ("http", "https")


def absolute_url(base: str, href: str) -> str:
    """Resolve ``href`` against ``base``, drop the fragment and percent-encode
    characters that are not allowed in a URL (spaces, quotes, non-ASCII)."""
    url, _fragment = urldefrag(urljoin(base, href.strip()))
    return quote(url, safe="%:/?#[]@!$&'()*+,;=~")


def normalize_url(url: str) -> str:
    """Canonical form used to spot duplicates: no fragment, lower-case
    scheme and host, default port dropped, empty path turned into "/"."""
    url, _fragment = urldefrag(url)
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    netloc = parts.netloc.lower()
    try:
        default_port = (scheme, parts.port) in (("http", 80), ("https", 443))
    except ValueError:  # non-numeric port; leave it alone
        default_port = False
    if default_port:
        netloc = netloc.rsplit(":", 1)[0]
    return urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))


def site_key(url: str) -> str:
    """Host used to decide whether a link stays on the same site. A leading
    "www." is ignored so www.example.com and example.com count as one site."""
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def looks_like_page(url: str) -> bool:
    return not urlsplit(url).path.lower().endswith(SKIP_EXTENSIONS)


def charset_from(content_type: str) -> str | None:
    """Charset declared in a Content-Type header, if any. Only an explicit
    declaration is trusted; otherwise BeautifulSoup sniffs the document."""
    match = re.search(r"charset=[\"']?([\w.:-]+)", content_type, re.IGNORECASE)
    return match.group(1) if match else None


def retry_after(response: requests.Response) -> float | None:
    """Seconds suggested by a Retry-After header (delay or HTTP date)."""
    value = response.headers.get("Retry-After")
    if not value:
        return None
    if value.strip().isdigit():
        return min(float(value), MAX_RETRY_WAIT)
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return min(max((when - datetime.now(timezone.utc)).total_seconds(), 0.0), MAX_RETRY_WAIT)


def read_limited(response: requests.Response, limit: int) -> bytes:
    """Read at most ``limit`` bytes of the body; longer bodies are truncated."""
    chunks: list[bytes] = []
    size = 0
    for chunk in response.iter_content(chunk_size=65536):
        chunks.append(chunk)
        size += len(chunk)
        if size >= limit:
            log.warning("%s: body larger than %d bytes, truncated", response.url, limit)
            break
    return b"".join(chunks)[:limit]


def parse_selector(spec: str) -> Selector:
    """argparse type for ``--select``: validates the CSS and splits off ``@attr``."""
    match = SELECTOR_RE.match(spec)
    css, attr = (match.group("css"), match.group("attr")) if match else (spec, None)
    try:
        BeautifulSoup("<html></html>", PARSER).select(css)
    except Exception as exc:  # soupsieve raises its own SelectorSyntaxError
        raise argparse.ArgumentTypeError(f"invalid CSS selector {css!r}: {exc}") from None
    return Selector(spec, css, attr)


# ---------------------------------------------------------------------------
# HTML extraction
# ---------------------------------------------------------------------------
HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"]


def heading_text(heading) -> str:
    """Text of a heading, excluding any heading nested inside it. Browsers close
    an unclosed <h1> when the next <h2> starts; lenient parsers nest them."""
    parts = [
        text for text in heading.find_all(string=True)
        if not isinstance(text, Comment) and text.find_parent(HEADING_TAGS) is heading
    ]
    return clean(" ".join(parts))


def extract(page: Page, raw: bytes, encoding: str | None, selectors: Sequence[Selector]) -> None:
    """Fill ``page`` from the HTML in ``raw``. URLs are made absolute."""
    soup = BeautifulSoup(raw, PARSER, from_encoding=encoding)

    base = page.final_url
    base_tag = soup.find("base", href=True)
    if base_tag:
        base = absolute_url(base, base_tag["href"])

    if soup.title and soup.title.string is not None:
        page.title = clean(soup.title.string)
    elif soup.title:
        page.title = clean(soup.title.get_text())

    metas: dict[str, str] = {}
    for meta in soup.find_all("meta"):
        name = (meta.get("name") or meta.get("property") or "").strip().lower()
        content = meta.get("content")
        if name and content and name not in metas:
            metas[name] = clean(content)
    page.description = metas.get("description") or metas.get("og:description") or ""

    page.headings = [
        {"level": int(h.name[1]), "text": text}
        for h in soup.find_all(["h1", "h2", "h3"])
        if (text := heading_text(h))
    ]

    seen: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = absolute_url(base, anchor["href"])
        if not is_http(href) or href in seen:
            continue
        seen.add(href)
        page.links.append({"url": href, "text": clean(anchor.get_text(" "))})

    seen.clear()
    for img in soup.find_all("img"):
        src = (img.get("src") or img.get("data-src") or "").strip()
        if not src:
            continue
        src = absolute_url(base, src)
        if not is_http(src) or src in seen:  # also drops inline data: URIs
            continue
        seen.add(src)
        page.images.append({"url": src, "alt": clean(img.get("alt") or "")})

    for selector in selectors:
        values: list[str] = []
        for element in soup.select(selector.css):
            value = element.get(selector.attr) if selector.attr else element.get_text(" ")
            if isinstance(value, list):  # multi-valued attributes such as class
                value = " ".join(value)
            if value is None:
                continue
            value = clean(value)
            if value and selector.attr in ("href", "src"):
                value = absolute_url(base, value)
            if value:
                values.append(value)
        page.selections[selector.spec] = values

    for tag in soup(["script", "style", "noscript", "template"]):
        tag.decompose()
    page.word_count = len(soup.get_text(" ").split())


# ---------------------------------------------------------------------------
# Fetching and crawling
# ---------------------------------------------------------------------------
class Scraper:
    """Fetches pages politely (robots.txt, pacing, retries) and extracts data."""

    def __init__(
        self,
        *,
        user_agent: str = DEFAULT_USER_AGENT,
        timeout: float = 15.0,
        retries: int = 2,
        delay: float = 1.0,
        max_bytes: int = 5_000_000,
        respect_robots: bool = True,
        same_site: bool = True,
        selectors: Sequence[Selector] = (),
    ) -> None:
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = retries
        self.delay = delay
        self.max_bytes = max_bytes
        self.respect_robots = respect_robots
        self.same_site = same_site
        self.selectors = list(selectors)
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": user_agent,
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
                "Accept-Language": "en",
            }
        )
        self._robots: dict[str, RobotsRules | None] = {}
        self._next_request_at = 0.0

    # -- politeness ---------------------------------------------------------
    def _wait_turn(self, delay: float) -> None:
        now = time.monotonic()
        if now < self._next_request_at:
            time.sleep(self._next_request_at - now)
        self._next_request_at = time.monotonic() + delay

    def _robots_for(self, url: str) -> RobotsRules | None:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            self._robots[origin] = self._load_robots(origin)
        return self._robots[origin]

    def _load_robots(self, origin: str) -> RobotsRules | None:
        """Fetch and parse robots.txt. ``None`` means "no restrictions"."""
        robots_url = origin + "/robots.txt"
        try:
            response = self.fetch(robots_url)
        except requests.RequestException as exc:
            log.warning("could not read %s (%s); assuming no restrictions", robots_url, exc)
            return None
        with response:
            if response.status_code >= 500:
                log.warning("%s answered HTTP %d; treating the site as off limits",
                            robots_url, response.status_code)
                return RobotsRules(disallow_all=True)
            if response.status_code >= 400:
                log.debug("no robots.txt at %s (HTTP %d)", robots_url, response.status_code)
                return None
            text = read_limited(response, 512_000).decode("utf-8", errors="replace")
        return RobotsRules.parse(text, self.user_agent)

    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        rules = self._robots_for(url)
        return rules is None or rules.allows(url)

    def crawl_delay(self, url: str) -> float:
        """The configured delay, or the site's Crawl-delay if that is longer."""
        if not self.respect_robots:
            return self.delay
        rules = self._robots_for(url)
        return max(self.delay, rules.crawl_delay if rules else 0.0)

    # -- HTTP ---------------------------------------------------------------
    def fetch(self, url: str, delay: float | None = None) -> requests.Response:
        """GET ``url`` with pacing and retries. Raises requests.RequestException
        once the retries are used up. The response is streamed; the caller
        reads (or closes) it."""
        delay = self.delay if delay is None else delay
        attempt = 0
        while True:
            attempt += 1
            self._wait_turn(delay)
            try:
                response = self.session.get(url, timeout=self.timeout, stream=True)
            except requests.RequestException as exc:
                if attempt > self.retries:
                    raise
                self._backoff(attempt, url, f"{type(exc).__name__}")
                continue
            if response.status_code in RETRY_STATUSES and attempt <= self.retries:
                wait = retry_after(response)
                response.close()
                self._backoff(attempt, url, f"HTTP {response.status_code}", wait)
                continue
            return response

    def _backoff(self, attempt: int, url: str, reason: str, wait: float | None = None) -> None:
        if wait is None:
            wait = min(2.0 ** attempt, MAX_RETRY_WAIT)  # 2s, 4s, 8s, ...
        log.warning("%s -> %s; retry %d/%d in %.0fs", url, reason, attempt, self.retries, wait)
        time.sleep(wait)

    # -- scraping -----------------------------------------------------------
    def scrape(self, url: str, depth: int = 0) -> Page:
        """Fetch one URL and return a Page (never raises; see ``Page.error``)."""
        page = Page(url=url, depth=depth, fetched_at=utc_now())
        if not self.allowed(url):
            page.error = "disallowed by robots.txt"
            return page
        try:
            response = self.fetch(url, self.crawl_delay(url))
        except requests.RequestException as exc:
            page.error = f"request failed: {type(exc).__name__}: {exc}"
            return page
        with response:
            page.final_url = response.url
            page.status = response.status_code
            content_type = response.headers.get("Content-Type", "")
            page.content_type = content_type.split(";")[0].strip().lower()
            if response.status_code >= 400:
                page.error = f"HTTP {response.status_code}"
                return page
            if page.content_type and page.content_type not in HTML_TYPES:
                page.error = f"not HTML ({page.content_type})"
                return page
            raw = read_limited(response, self.max_bytes)
        try:
            extract(page, raw, charset_from(content_type), self.selectors)
        except Exception as exc:  # one broken page must not kill the crawl
            page.error = f"parse failed: {type(exc).__name__}: {exc}"
        return page

    def crawl(self, start_urls: Sequence[str], depth: int = 0, max_pages: int = 50) -> Iterator[Page]:
        """Breadth-first crawl from ``start_urls``, yielding one Page per URL."""
        queue: deque[tuple[str, int]] = deque()
        seen: set[str] = set()
        for url in start_urls:
            url = normalize_url(url)
            if url not in seen:
                seen.add(url)
                queue.append((url, 0))
        sites = {site_key(url) for url, _ in queue}

        fetched = 0
        while queue and fetched < max_pages:
            url, level = queue.popleft()
            page = self.scrape(url, level)
            fetched += 1
            yield page
            if level >= depth or page.error:
                continue
            if page.final_url:
                seen.add(normalize_url(page.final_url))
            for link in page.links:
                target = normalize_url(link["url"])
                if target in seen or not looks_like_page(target):
                    continue
                if self.same_site and site_key(target) not in sites:
                    continue
                seen.add(target)
                queue.append((target, level + 1))
        if queue:
            log.info("stopped at --max-pages %d with %d URLs still queued", max_pages, len(queue))


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def write_csv(rows: list[dict], out, selectors: Sequence[Selector]) -> None:
    columns = ["url", "final_url", "status", "depth", "title", "description", "h1",
               "links", "images", "word_count", "error"] + ["select:" + s.spec for s in selectors]
    writer = csv.writer(out)
    writer.writerow(columns)
    for row in rows:
        h1 = " | ".join(h["text"] for h in row["headings"] if h["level"] == 1)
        values = [row["url"], row["final_url"], row["status"], row["depth"], row["title"],
                  row["description"], h1, len(row["links"]), len(row["images"]),
                  row["word_count"], row["error"] or ""]
        values += [" | ".join(row["selections"].get(s.spec, [])) for s in selectors]
        writer.writerow(values)


def write_output(pages: list[Page], fmt: str, path: str | None, selectors: Sequence[Selector]) -> None:
    rows = [asdict(page) for page in pages]
    out = open(path, "w", encoding="utf-8", newline="") if path else sys.stdout
    try:
        if fmt == "json":
            json.dump(rows, out, indent=2, ensure_ascii=False)
            out.write("\n")
        elif fmt == "jsonl":
            for row in rows:
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
        else:
            write_csv(rows, out, selectors)
    finally:
        if path:
            out.close()


def guess_format(path: str | None) -> str:
    if path:
        lower = path.lower()
        if lower.endswith(".csv"):
            return "csv"
        if lower.endswith((".jsonl", ".ndjson")):
            return "jsonl"
    return "json"


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scrape one or more web pages (title, description, headings, links, "
                    "images, word count, CSS-selector matches) and optionally crawl a site.",
        epilog=(
            "examples:\n"
            "  %(prog)s https://example.com\n"
            "  %(prog)s https://example.com --depth 1 --max-pages 25 -o site.json\n"
            "  %(prog)s https://example.com -s 'h2.title' -s 'a.btn@href'\n"
            "  %(prog)s https://example.com --depth 1 -o pages.csv"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("urls", nargs="+", metavar="URL", help="one or more http(s) URLs to start from")
    parser.add_argument("-o", "--output", metavar="FILE", help="write results to FILE instead of stdout")
    parser.add_argument("-f", "--format", choices=("json", "jsonl", "csv"),
                        help="output format (default: json, or guessed from the FILE extension)")
    parser.add_argument("-d", "--depth", type=int, default=0, metavar="N",
                        help="follow links N levels deep (default: 0, only the given URLs)")
    parser.add_argument("-m", "--max-pages", type=int, default=50, metavar="N",
                        help="stop after fetching N pages (default: 50)")
    parser.add_argument("-s", "--select", dest="selectors", action="append", default=[],
                        type=parse_selector, metavar="SELECTOR",
                        help="CSS selector to extract (repeatable); append @attr to read an "
                             "attribute instead of the text, e.g. 'a.btn@href'")
    parser.add_argument("--delay", type=float, default=1.0, metavar="SECONDS",
                        help="minimum pause between requests (default: 1)")
    parser.add_argument("--timeout", type=float, default=15.0, metavar="SECONDS",
                        help="per-request timeout (default: 15)")
    parser.add_argument("--retries", type=int, default=2, metavar="N",
                        help="retries for network errors and HTTP 429/5xx (default: 2)")
    parser.add_argument("--max-bytes", type=int, default=5_000_000, metavar="N",
                        help="read at most N bytes per page (default: 5000000)")
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT, metavar="STRING",
                        help="User-Agent header to send")
    parser.add_argument("--allow-external", action="store_true",
                        help="when crawling, also follow links to other sites")
    parser.add_argument("--ignore-robots", action="store_true",
                        help="do not consult robots.txt (only for sites you own)")
    verbosity = parser.add_mutually_exclusive_group()
    verbosity.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    verbosity.add_argument("-q", "--quiet", action="store_true", help="only log errors")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    level = logging.DEBUG if args.verbose else logging.ERROR if args.quiet else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s: %(message)s", stream=sys.stderr)

    urls = [url if "://" in url else "https://" + url for url in args.urls]
    bad = [url for url in urls if not is_http(url) or not urlsplit(url).netloc]
    if bad:
        parser.error("not an http(s) URL: " + ", ".join(bad))
    if args.depth < 0 or args.max_pages < 1 or args.delay < 0 or args.retries < 0:
        parser.error("--depth, --delay and --retries must be >= 0 and --max-pages >= 1")
    if args.max_bytes < 1024:
        parser.error("--max-bytes must be at least 1024")
    fmt = args.format or guess_format(args.output)

    scraper = Scraper(
        user_agent=args.user_agent,
        timeout=args.timeout,
        retries=args.retries,
        delay=args.delay,
        max_bytes=args.max_bytes,
        respect_robots=not args.ignore_robots,
        same_site=not args.allow_external,
        selectors=args.selectors,
    )

    pages: list[Page] = []
    try:
        for page in scraper.crawl(urls, depth=args.depth, max_pages=args.max_pages):
            pages.append(page)
            summary = page.error or (
                f"HTTP {page.status}, {len(page.links)} links, {len(page.images)} images, "
                f"{page.word_count} words"
            )
            log.info("[%d/%d] %s -> %s", len(pages), args.max_pages, page.url, summary)
    except KeyboardInterrupt:
        log.warning("interrupted; writing the %d pages collected so far", len(pages))

    write_output(pages, fmt, args.output, args.selectors)
    failed = sum(1 for page in pages if page.error)
    log.info("done: %d pages, %d failed%s", len(pages), failed,
             f", written to {args.output}" if args.output else "")
    return 1 if pages and failed == len(pages) else 0


if __name__ == "__main__":
    sys.exit(main())
