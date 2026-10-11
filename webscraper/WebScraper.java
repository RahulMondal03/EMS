/*
 * WebScraper.java - a small, polite web scraper in plain Java (11 or newer), no libraries.
 *
 * Compile and run:
 *     javac WebScraper.java && java WebScraper https://example.com
 * or run straight from the source file:
 *     java WebScraper.java https://example.com --depth 1 --max-pages 25 --output site.json
 *
 * For every page it records the title, meta description, h1-h3 headings, links, images and
 * a word count, then optionally follows same-site links breadth-first. It honours robots.txt
 * (including Crawl-delay), identifies itself with a User-Agent, waits between requests and
 * retries transient failures with exponential backoff. The output is a JSON array with one
 * object per page; failures are reported in that object's "error" field. Only scrape sites
 * whose terms allow it.
 *
 * Options:
 *   -o, --output FILE        write JSON to FILE instead of stdout
 *   -d, --depth N            follow links N levels deep (default 0: only the given URLs)
 *   -m, --max-pages N        stop after fetching N pages (default 50)
 *       --delay SECONDS      minimum pause between requests (default 1)
 *       --timeout SECONDS    per-request timeout (default 15)
 *       --retries N          retries for network errors and HTTP 429/5xx (default 2)
 *       --max-bytes N        read at most N bytes per page (default 5000000)
 *       --user-agent STRING  User-Agent header to send
 *       --allow-external     when crawling, also follow links to other sites
 *       --ignore-robots      do not consult robots.txt (only for sites you own)
 *   -q, --quiet              only report errors
 *   -h, --help               show this help
 */

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.PrintStream;
import java.io.Writer;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

public final class WebScraper {

    static final String DEFAULT_USER_AGENT = "ems-webscraper/1.0 (+https://github.com/rahulmondal03/ems)";
    static final Set<Integer> RETRY_STATUSES = Set.of(429, 500, 502, 503, 504);
    static final double MAX_RETRY_WAIT = 60.0;
    /** Links ending like this are never queued while crawling: they are not pages. */
    static final List<String> SKIP_EXTENSIONS = List.of(
        ".css", ".js", ".json", ".xml", ".rss", ".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg",
        ".webp", ".bmp", ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z", ".mp3", ".mp4", ".avi",
        ".mov", ".woff", ".woff2", ".ttf", ".eot", ".exe", ".dmg", ".doc", ".docx", ".xls",
        ".xlsx", ".ppt", ".pptx");
    static final Pattern CHARSET = Pattern.compile("charset=\\s*[\"']?\\s*([\\w.:-]+)", Pattern.CASE_INSENSITIVE);

    static boolean quiet;

    static void info(String message) {
        if (!quiet) System.err.println("INFO: " + message);
    }

    static void warn(String message) {
        if (!quiet) System.err.println("WARNING: " + message);
    }

    public static void main(String[] args) throws IOException {
        Options opt = Options.parse(args);
        quiet = opt.quiet;

        Scraper scraper = new Scraper(opt);
        List<Page> pages = scraper.crawl(opt.urls, opt.depth, opt.maxPages);

        Writer out = opt.output != null
            ? Files.newBufferedWriter(Paths.get(opt.output), StandardCharsets.UTF_8)
            : new OutputStreamWriter(System.out, StandardCharsets.UTF_8);
        try {
            Json.write(out, pages);
        } finally {
            if (opt.output != null) out.close(); else out.flush();
        }

        long failed = pages.stream().filter(p -> p.error != null).count();
        info(String.format("done: %d pages, %d failed%s", pages.size(), failed,
            opt.output != null ? ", written to " + opt.output : ""));
        System.exit(!pages.isEmpty() && failed == pages.size() ? 1 : 0);
    }

    // -----------------------------------------------------------------------------------
    // Command line
    // -----------------------------------------------------------------------------------
    static final class Options {
        final List<String> urls = new ArrayList<>();
        String output;
        int depth = 0;
        int maxPages = 50;
        int retries = 2;
        double delay = 1.0;
        double timeout = 15.0;
        int maxBytes = 5_000_000;
        String userAgent = DEFAULT_USER_AGENT;
        boolean allowExternal;
        boolean ignoreRobots;
        boolean quiet;

        static Options parse(String[] args) {
            Options o = new Options();
            for (int i = 0; i < args.length; i++) {
                String a = args[i];
                switch (a) {
                    case "-h": case "--help":
                        usage(System.out);
                        System.exit(0);
                        break;
                    case "-q": case "--quiet": o.quiet = true; break;
                    case "--allow-external": o.allowExternal = true; break;
                    case "--ignore-robots": o.ignoreRobots = true; break;
                    case "-o": case "--output": o.output = value(args, ++i, a); break;
                    case "-d": case "--depth": o.depth = intValue(args, ++i, a); break;
                    case "-m": case "--max-pages": o.maxPages = intValue(args, ++i, a); break;
                    case "--retries": o.retries = intValue(args, ++i, a); break;
                    case "--max-bytes": o.maxBytes = intValue(args, ++i, a); break;
                    case "--delay": o.delay = doubleValue(args, ++i, a); break;
                    case "--timeout": o.timeout = doubleValue(args, ++i, a); break;
                    case "--user-agent": o.userAgent = value(args, ++i, a); break;
                    default:
                        if (a.startsWith("-") && a.length() > 1) fail("unknown option: " + a);
                        String url = a.contains("://") ? a : "https://" + a;
                        if (Urls.normalize(url) == null) fail("not an http(s) URL: " + a);
                        o.urls.add(url);
                }
            }
            if (o.urls.isEmpty()) fail("at least one URL is required");
            if (o.depth < 0 || o.maxPages < 1 || o.delay < 0 || o.retries < 0 || o.timeout <= 0) {
                fail("--depth, --delay and --retries must be >= 0, --max-pages >= 1, --timeout > 0");
            }
            if (o.maxBytes < 1024) fail("--max-bytes must be at least 1024");
            return o;
        }

        static String value(String[] args, int i, String option) {
            if (i >= args.length) fail(option + " requires a value");
            return args[i];
        }

        static int intValue(String[] args, int i, String option) {
            try {
                return Integer.parseInt(value(args, i, option));
            } catch (NumberFormatException e) {
                fail(option + " expects an integer, got '" + args[i] + "'");
                return 0; // unreachable
            }
        }

        static double doubleValue(String[] args, int i, String option) {
            try {
                return Double.parseDouble(value(args, i, option));
            } catch (NumberFormatException e) {
                fail(option + " expects a number, got '" + args[i] + "'");
                return 0; // unreachable
            }
        }

        static void fail(String message) {
            System.err.println("error: " + message);
            System.err.println("Run with --help for usage.");
            System.exit(2);
        }

        static void usage(PrintStream out) {
            out.println("usage: java WebScraper [options] URL [URL ...]");
            out.println();
            out.println("Scrape one or more web pages (title, description, headings, links, images,");
            out.println("word count) and optionally crawl a site. Results are printed as JSON.");
            out.println();
            out.println("options:");
            out.println("  -o, --output FILE        write JSON to FILE instead of stdout");
            out.println("  -d, --depth N            follow links N levels deep (default 0: only the given URLs)");
            out.println("  -m, --max-pages N        stop after fetching N pages (default 50)");
            out.println("      --delay SECONDS      minimum pause between requests (default 1)");
            out.println("      --timeout SECONDS    per-request timeout (default 15)");
            out.println("      --retries N          retries for network errors and HTTP 429/5xx (default 2)");
            out.println("      --max-bytes N        read at most N bytes per page (default 5000000)");
            out.println("      --user-agent STRING  User-Agent header to send");
            out.println("      --allow-external     when crawling, also follow links to other sites");
            out.println("      --ignore-robots      do not consult robots.txt (only for sites you own)");
            out.println("  -q, --quiet              only report errors");
            out.println("  -h, --help               show this help");
            out.println();
            out.println("examples:");
            out.println("  java WebScraper https://example.com");
            out.println("  java WebScraper https://example.com --depth 1 --max-pages 25 -o site.json");
        }
    }

    // -----------------------------------------------------------------------------------
    // Data model
    // -----------------------------------------------------------------------------------
    static final class Heading {
        final int level;
        final String text;

        Heading(int level, String text) {
            this.level = level;
            this.text = text;
        }
    }

    /** A link (text = anchor text) or an image (text = alt text). */
    static final class Link {
        final String url;
        final String text;

        Link(String url, String text) {
            this.url = url;
            this.text = text;
        }
    }

    /** Everything extracted from one URL; {@code error} is set when it failed. */
    static final class Page {
        final String url;
        final int depth;
        String finalUrl = "";
        Integer status;
        String contentType = "";
        String fetchedAt = "";
        String title = "";
        String description = "";
        final List<Heading> headings = new ArrayList<>();
        final List<Link> links = new ArrayList<>();
        final List<Link> images = new ArrayList<>();
        int wordCount;
        String error;

        Page(String url, int depth) {
            this.url = url;
            this.depth = depth;
        }

        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("url", url);
            m.put("depth", depth);
            m.put("final_url", finalUrl);
            m.put("status", status);
            m.put("content_type", contentType);
            m.put("fetched_at", fetchedAt);
            m.put("title", title);
            m.put("description", description);
            List<Object> hs = new ArrayList<>();
            for (Heading h : headings) {
                Map<String, Object> hm = new LinkedHashMap<>();
                hm.put("level", h.level);
                hm.put("text", h.text);
                hs.add(hm);
            }
            m.put("headings", hs);
            m.put("links", linkMaps(links, "text"));
            m.put("images", linkMaps(images, "alt"));
            m.put("word_count", wordCount);
            m.put("error", error);
            return m;
        }

        private static List<Object> linkMaps(List<Link> items, String textKey) {
            List<Object> out = new ArrayList<>();
            for (Link l : items) {
                Map<String, Object> lm = new LinkedHashMap<>();
                lm.put("url", l.url);
                lm.put(textKey, l.text);
                out.add(lm);
            }
            return out;
        }
    }

    /** Result of one HTTP GET. */
    static final class Fetched {
        int status;
        String finalUrl;
        String contentType;
        byte[] body;
        boolean truncated;
    }

    // -----------------------------------------------------------------------------------
    // Fetching and crawling
    // -----------------------------------------------------------------------------------
    static final class Scraper {
        private final Options opt;
        private final HttpClient client;
        private final Map<String, Robots> robotsCache = new HashMap<>();
        private long nextRequestAtNanos;

        Scraper(Options opt) {
            this.opt = opt;
            this.client = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NORMAL)
                .connectTimeout(Duration.ofMillis((long) (opt.timeout * 1000)))
                .build();
        }

        private static final class QueueItem {
            final String url;
            final int depth;

            QueueItem(String url, int depth) {
                this.url = url;
                this.depth = depth;
            }
        }

        /** Breadth-first crawl from the start URLs; one Page per fetched URL. */
        List<Page> crawl(List<String> startUrls, int depth, int maxPages) {
            Deque<QueueItem> queue = new ArrayDeque<>();
            Set<String> seen = new HashSet<>();
            Set<String> sites = new HashSet<>();
            for (String url : startUrls) {
                String normalized = Urls.normalize(url);
                if (normalized != null && seen.add(normalized)) {
                    queue.add(new QueueItem(normalized, 0));
                    sites.add(Urls.siteKey(normalized));
                }
            }

            List<Page> pages = new ArrayList<>();
            while (!queue.isEmpty() && pages.size() < maxPages) {
                QueueItem item = queue.poll();
                Page page = scrape(item.url, item.depth);
                pages.add(page);
                String summary = page.error != null ? page.error : String.format(
                    "HTTP %d, %d links, %d images, %d words",
                    page.status, page.links.size(), page.images.size(), page.wordCount);
                info(String.format("[%d/%d] %s -> %s", pages.size(), maxPages, page.url, summary));

                if (item.depth >= depth || page.error != null) continue;
                String finalNormalized = Urls.normalize(page.finalUrl);
                if (finalNormalized != null) seen.add(finalNormalized);
                for (Link link : page.links) {
                    String target = Urls.normalize(link.url);
                    if (target == null || seen.contains(target) || !Urls.looksLikePage(target)) continue;
                    if (!opt.allowExternal && !sites.contains(Urls.siteKey(target))) continue;
                    seen.add(target);
                    queue.add(new QueueItem(target, item.depth + 1));
                }
            }
            if (!queue.isEmpty()) {
                info("stopped at --max-pages " + maxPages + " with " + queue.size() + " URLs still queued");
            }
            return pages;
        }

        /** Fetch one URL and return a Page; never throws (see Page.error). */
        Page scrape(String url, int depth) {
            Page page = new Page(url, depth);
            page.fetchedAt = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString();

            double delay = opt.delay;
            if (!opt.ignoreRobots) {
                Robots robots = robotsFor(url);
                if (robots != null) {
                    if (!robots.allows(url)) {
                        page.error = "disallowed by robots.txt";
                        return page;
                    }
                    delay = Math.max(delay, robots.crawlDelay);
                }
            }

            Fetched fetched;
            try {
                fetched = fetch(url, delay);
            } catch (IOException e) {
                page.error = "request failed: " + e.getClass().getSimpleName()
                    + (e.getMessage() != null ? ": " + e.getMessage() : "");
                return page;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                page.error = "interrupted";
                return page;
            }

            page.finalUrl = fetched.finalUrl;
            page.status = fetched.status;
            page.contentType = mediaType(fetched.contentType);
            if (fetched.status >= 400) {
                page.error = "HTTP " + fetched.status;
                return page;
            }
            if (!page.contentType.isEmpty() && !isHtml(page.contentType)) {
                page.error = "not HTML (" + page.contentType + ")";
                return page;
            }
            if (fetched.truncated) {
                warn(url + ": body larger than " + opt.maxBytes + " bytes, truncated");
            }
            try {
                Html.extract(page, decode(fetched.body, fetched.contentType));
            } catch (RuntimeException e) { // one broken page must not kill the crawl
                page.error = "parse failed: " + e;
            }
            return page;
        }

        /** GET with pacing and retries; throws once the retries are used up. */
        Fetched fetch(String url, double delay) throws IOException, InterruptedException {
            for (int attempt = 1; ; attempt++) {
                waitTurn(delay);
                HttpRequest request;
                try {
                    request = HttpRequest.newBuilder(URI.create(url))
                        .timeout(Duration.ofMillis((long) (opt.timeout * 1000)))
                        .header("User-Agent", opt.userAgent)
                        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
                        .header("Accept-Language", "en")
                        .GET()
                        .build();
                } catch (IllegalArgumentException e) {
                    throw new IOException("invalid URL: " + e.getMessage(), e);
                }

                HttpResponse<InputStream> response;
                Fetched fetched = new Fetched();
                try {
                    response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
                    fetched.status = response.statusCode();
                    if (RETRY_STATUSES.contains(fetched.status) && attempt <= opt.retries) {
                        response.body().close();
                        backoff(attempt, url, "HTTP " + fetched.status, retryAfter(response));
                        continue;
                    }
                    fetched.finalUrl = response.uri().toString();
                    fetched.contentType = response.headers().firstValue("Content-Type").orElse("");
                    try (InputStream in = decompressed(response)) {
                        readBody(in, fetched);
                    }
                } catch (IOException e) {
                    if (attempt > opt.retries) throw e;
                    backoff(attempt, url, e.getClass().getSimpleName(), null);
                    continue;
                }
                return fetched;
            }
        }

        private void readBody(InputStream in, Fetched fetched) throws IOException {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[65536];
            int n;
            while ((n = in.read(buffer)) != -1) {
                int room = opt.maxBytes - out.size();
                if (n > room) {
                    out.write(buffer, 0, room);
                    fetched.truncated = true;
                    break;
                }
                out.write(buffer, 0, n);
                if (out.size() == opt.maxBytes) {
                    fetched.truncated = in.read() != -1;
                    break;
                }
            }
            fetched.body = out.toByteArray();
        }

        private static InputStream decompressed(HttpResponse<InputStream> response) throws IOException {
            String encoding = response.headers().firstValue("Content-Encoding").orElse("").trim().toLowerCase(Locale.ROOT);
            if (encoding.equals("gzip") || encoding.equals("x-gzip")) return new GZIPInputStream(response.body());
            if (encoding.equals("deflate")) return new InflaterInputStream(response.body());
            return response.body();
        }

        private void waitTurn(double delay) throws InterruptedException {
            long now = System.nanoTime();
            if (now < nextRequestAtNanos) {
                Thread.sleep((nextRequestAtNanos - now) / 1_000_000 + 1);
            }
            nextRequestAtNanos = System.nanoTime() + (long) (delay * 1_000_000_000L);
        }

        private void backoff(int attempt, String url, String reason, Double wait) throws InterruptedException {
            double seconds = wait != null ? wait : Math.min(Math.pow(2, attempt), MAX_RETRY_WAIT); // 2s, 4s, 8s ...
            warn(String.format(Locale.ROOT, "%s -> %s; retry %d/%d in %.0fs", url, reason, attempt, opt.retries, seconds));
            Thread.sleep((long) (seconds * 1000));
        }

        /** Seconds suggested by a Retry-After header (delay or HTTP date), if any. */
        private static Double retryAfter(HttpResponse<?> response) {
            String value = response.headers().firstValue("Retry-After").orElse(null);
            if (value == null) return null;
            value = value.trim();
            if (value.matches("\\d+")) return Math.min(Double.parseDouble(value), MAX_RETRY_WAIT);
            try {
                Instant when = ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant();
                long seconds = Duration.between(Instant.now(), when).getSeconds();
                return Math.min(Math.max(seconds, 0), MAX_RETRY_WAIT);
            } catch (DateTimeParseException e) {
                return null;
            }
        }

        private Robots robotsFor(String url) {
            URI u = URI.create(url);
            String origin = u.getScheme() + "://" + u.getRawAuthority();
            if (!robotsCache.containsKey(origin)) {
                robotsCache.put(origin, loadRobots(origin));
            }
            return robotsCache.get(origin);
        }

        /** Fetch and parse robots.txt; null means "no restrictions". */
        private Robots loadRobots(String origin) {
            String robotsUrl = origin + "/robots.txt";
            Fetched fetched;
            try {
                fetched = fetch(robotsUrl, opt.delay);
            } catch (IOException e) {
                String reason = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                warn("could not read " + robotsUrl + " (" + reason + "); assuming no restrictions");
                return null;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
            if (fetched.status >= 500) {
                warn(robotsUrl + " answered HTTP " + fetched.status + "; treating the site as off limits");
                return Robots.DISALLOW_ALL;
            }
            if (fetched.status >= 400) return null;
            return Robots.parse(new String(fetched.body, StandardCharsets.UTF_8), opt.userAgent);
        }

        static String mediaType(String contentType) {
            int semicolon = contentType.indexOf(';');
            return (semicolon >= 0 ? contentType.substring(0, semicolon) : contentType).trim().toLowerCase(Locale.ROOT);
        }

        static boolean isHtml(String mediaType) {
            return mediaType.equals("text/html") || mediaType.equals("application/xhtml+xml");
        }

        /** Decode the body using the header charset, else a charset sniffed from the first 4 KB, else UTF-8. */
        static String decode(byte[] body, String contentType) {
            Charset charset = charsetOf(contentType);
            if (charset == null) {
                String head = new String(body, 0, Math.min(body.length, 4096), StandardCharsets.ISO_8859_1);
                charset = charsetOf(head);
            }
            return new String(body, charset != null ? charset : StandardCharsets.UTF_8);
        }

        private static Charset charsetOf(String text) {
            Matcher m = CHARSET.matcher(text);
            if (!m.find()) return null;
            try {
                return Charset.forName(m.group(1));
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
    }

    // -----------------------------------------------------------------------------------
    // robots.txt
    // -----------------------------------------------------------------------------------
    static final class Robots {
        static final Robots DISALLOW_ALL = new Robots(List.of(new Rule("/", false)), 0);

        static final class Rule {
            final String pattern;
            final boolean allow;

            Rule(String pattern, boolean allow) {
                this.pattern = pattern;
                this.allow = allow;
            }
        }

        private static final class Group {
            final List<String> agents = new ArrayList<>();
            final List<Rule> rules = new ArrayList<>();
            double crawlDelay;
        }

        final List<Rule> rules;
        final double crawlDelay;

        Robots(List<Rule> rules, double crawlDelay) {
            this.rules = rules;
            this.crawlDelay = crawlDelay;
        }

        /** Keep the groups addressed to our User-Agent token, or the "*" groups otherwise. */
        static Robots parse(String text, String userAgent) {
            String token = userAgent.split("/", 2)[0].trim().toLowerCase(Locale.ROOT);
            List<Group> groups = new ArrayList<>();
            Group current = null;
            boolean inAgentLines = false;
            for (String rawLine : text.split("\\r?\\n")) {
                String line = rawLine;
                int hash = line.indexOf('#');
                if (hash >= 0) line = line.substring(0, hash);
                line = line.trim();
                int colon = line.indexOf(':');
                if (colon < 0) continue;
                String key = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = line.substring(colon + 1).trim();
                if (key.equals("user-agent")) {
                    if (!inAgentLines) {
                        current = new Group();
                        groups.add(current);
                        inAgentLines = true;
                    }
                    current.agents.add(value.toLowerCase(Locale.ROOT));
                } else if (current != null) {
                    inAgentLines = false;
                    switch (key) {
                        case "allow": if (!value.isEmpty()) current.rules.add(new Rule(value, true)); break;
                        case "disallow": if (!value.isEmpty()) current.rules.add(new Rule(value, false)); break;
                        case "crawl-delay":
                            try {
                                current.crawlDelay = Double.parseDouble(value);
                            } catch (NumberFormatException ignored) {
                                // not a number; ignore
                            }
                            break;
                        default: break;
                    }
                }
            }

            boolean specific = groups.stream().anyMatch(g -> g.agents.stream()
                .anyMatch(a -> !a.equals("*") && !a.isEmpty() && token.contains(a)));
            List<Rule> rules = new ArrayList<>();
            double crawlDelay = 0;
            for (Group g : groups) {
                boolean chosen = specific
                    ? g.agents.stream().anyMatch(a -> !a.equals("*") && !a.isEmpty() && token.contains(a))
                    : g.agents.contains("*");
                if (!chosen) continue;
                rules.addAll(g.rules);
                crawlDelay = Math.max(crawlDelay, g.crawlDelay);
            }
            return new Robots(rules, crawlDelay);
        }

        /** Longest matching rule wins; Allow wins a tie (as in RFC 9309). */
        boolean allows(String url) {
            URI u = URI.create(url);
            String path = u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath();
            if (u.getRawQuery() != null) path += "?" + u.getRawQuery();
            int bestLength = -1;
            boolean allowed = true;
            for (Rule rule : rules) {
                if (!matches(rule.pattern, path)) continue;
                int length = rule.pattern.length();
                if (length > bestLength || (length == bestLength && rule.allow)) {
                    bestLength = length;
                    allowed = rule.allow;
                }
            }
            return allowed;
        }

        /** Prefix match supporting "*" wildcards and a "$" end anchor. */
        static boolean matches(String pattern, String path) {
            boolean anchored = pattern.endsWith("$");
            if (anchored) pattern = pattern.substring(0, pattern.length() - 1);
            return matchAt(pattern, 0, path, 0, anchored);
        }

        private static boolean matchAt(String p, int i, String s, int j, boolean full) {
            while (i < p.length()) {
                char c = p.charAt(i);
                if (c == '*') {
                    while (i < p.length() && p.charAt(i) == '*') i++;
                    if (i == p.length()) return true;
                    for (int k = j; k <= s.length(); k++) {
                        if (matchAt(p, i, s, k, full)) return true;
                    }
                    return false;
                }
                if (j >= s.length() || s.charAt(j) != c) return false;
                i++;
                j++;
            }
            return !full || j == s.length();
        }
    }

    // -----------------------------------------------------------------------------------
    // URL helpers
    // -----------------------------------------------------------------------------------
    static final class Urls {
        /** Canonical form for duplicate detection, or null if not a valid http(s) URL:
         *  lower-case scheme and host, default port dropped, fragment removed, "/" path. */
        static String normalize(String url) {
            URI u;
            try {
                u = new URI(encodeUnsafe(url.trim()));
            } catch (URISyntaxException e) {
                return null;
            }
            if (u.getScheme() == null || u.getHost() == null) return null;
            String scheme = u.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return null;
            int port = u.getPort();
            if ((scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443)) port = -1;
            String path = u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath();
            StringBuilder sb = new StringBuilder(scheme).append("://");
            if (u.getRawUserInfo() != null) sb.append(u.getRawUserInfo()).append('@');
            sb.append(u.getHost().toLowerCase(Locale.ROOT));
            if (port != -1) sb.append(':').append(port);
            sb.append(path);
            if (u.getRawQuery() != null) sb.append('?').append(u.getRawQuery());
            return sb.toString();
        }

        /** Host used to decide whether a link stays on the same site ("www." is ignored). */
        static String siteKey(String normalizedUrl) {
            String host = URI.create(normalizedUrl).getHost();
            host = host == null ? "" : host.toLowerCase(Locale.ROOT);
            return host.startsWith("www.") ? host.substring(4) : host;
        }

        static boolean looksLikePage(String normalizedUrl) {
            String path = URI.create(normalizedUrl).getRawPath().toLowerCase(Locale.ROOT);
            for (String ext : SKIP_EXTENSIONS) {
                if (path.endsWith(ext)) return false;
            }
            return true;
        }

        /** Resolve href against base and drop the fragment; null unless the result is http(s). */
        static String resolve(String base, String href) {
            try {
                URI baseUri = new URI(encodeUnsafe(base));
                if (baseUri.getRawPath() == null || baseUri.getRawPath().isEmpty()) {
                    baseUri = new URI(baseUri.getScheme(), baseUri.getRawAuthority(), "/", baseUri.getRawQuery(), null);
                }
                href = encodeUnsafe(href.trim());
                int fragment = href.indexOf('#');
                if (fragment >= 0) href = href.substring(0, fragment);
                if (href.isEmpty()) { // "" and "#..." mean this very page; java.net.URI would drop the last path segment
                    href = baseUri.getRawPath().substring(baseUri.getRawPath().lastIndexOf('/') + 1);
                    if (baseUri.getRawQuery() != null) href += "?" + baseUri.getRawQuery();
                    if (href.isEmpty()) href = ".";
                }
                if (href.startsWith("?")) { // java.net.URI drops the last path segment for query-only references
                    String basePath = baseUri.getRawPath();
                    href = basePath.substring(basePath.lastIndexOf('/') + 1) + href;
                }
                URI resolved = baseUri.resolve(new URI(href));
                String scheme = resolved.getScheme();
                if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
                    return null;
                }
                if (resolved.getRawAuthority() == null) return null;
                // java.net.URI keeps "/.." segments it cannot resolve; a browser drops them.
                String path = resolved.getRawPath() == null ? "" : resolved.getRawPath();
                while (path.startsWith("/../")) path = path.substring(3);
                if (path.equals("/..")) path = "/";
                if (path.isEmpty()) path = "/";
                StringBuilder sb = new StringBuilder(scheme.toLowerCase(Locale.ROOT)).append("://")
                    .append(resolved.getRawAuthority()).append(path);
                if (resolved.getRawQuery() != null) sb.append('?').append(resolved.getRawQuery());
                return sb.toString();
            } catch (URISyntaxException | IllegalArgumentException e) {
                return null;
            }
        }

        /** Percent-encode characters that java.net.URI rejects (spaces, quotes, braces, non-ASCII). */
        static String encodeUnsafe(String s) {
            StringBuilder sb = new StringBuilder(s.length());
            for (int i = 0; i < s.length(); ) {
                int cp = s.codePointAt(i);
                i += Character.charCount(cp);
                if (cp <= 0x20 || cp >= 0x7F || "\"<>\\^`{|}".indexOf(cp) >= 0) {
                    for (byte b : new String(Character.toChars(cp)).getBytes(StandardCharsets.UTF_8)) {
                        sb.append(String.format("%%%02X", b & 0xff));
                    }
                } else {
                    sb.append((char) cp);
                }
            }
            return sb.toString();
        }
    }

    // -----------------------------------------------------------------------------------
    // HTML extraction (a small tolerant tokenizer; no external parser)
    // -----------------------------------------------------------------------------------
    static final class Html {
        static final Set<String> RAW_TEXT = Set.of("script", "style", "noscript", "template");
        static final Pattern WHITESPACE = Pattern.compile("[\\s\\u00A0]+");

        /** An opening or closing tag with its (entity-decoded) attributes. */
        static final class Tag {
            String name;
            boolean closing;
            final Map<String, String> attrs = new LinkedHashMap<>();
            int end; // index just past the tag

            String attr(String key) {
                return attrs.get(key);
            }

            /** Parse the tag starting at s[lt] == '<'; null if that '<' does not start a tag. */
            static Tag parse(String s, int lt) {
                int n = s.length();
                int i = lt + 1;
                Tag tag = new Tag();
                if (i < n && s.charAt(i) == '/') {
                    tag.closing = true;
                    i++;
                }
                int start = i;
                while (i < n && (Character.isLetterOrDigit(s.charAt(i)) || s.charAt(i) == '-' || s.charAt(i) == ':' || s.charAt(i) == '_')) i++;
                if (i == start) return null;
                tag.name = s.substring(start, i).toLowerCase(Locale.ROOT);

                while (i < n) {
                    char c = s.charAt(i);
                    if (c == '>') {
                        i++;
                        break;
                    }
                    if (c == '<') break; // broken markup: let the next tag start cleanly
                    if (c == '/' || Character.isWhitespace(c)) {
                        i++;
                        continue;
                    }
                    int nameStart = i;
                    while (i < n && !Character.isWhitespace(s.charAt(i)) && s.charAt(i) != '=' && s.charAt(i) != '>' && s.charAt(i) != '<') i++;
                    if (i == nameStart) { // a stray '='
                        i++;
                        continue;
                    }
                    String name = s.substring(nameStart, i).toLowerCase(Locale.ROOT);
                    while (i < n && Character.isWhitespace(s.charAt(i))) i++;
                    String value = "";
                    if (i < n && s.charAt(i) == '=') {
                        i++;
                        while (i < n && Character.isWhitespace(s.charAt(i))) i++;
                        if (i < n && (s.charAt(i) == '"' || s.charAt(i) == '\'')) {
                            char quote = s.charAt(i++);
                            int valueStart = i;
                            while (i < n && s.charAt(i) != quote) i++;
                            value = s.substring(valueStart, i);
                            if (i < n) i++;
                        } else {
                            int valueStart = i;
                            while (i < n && !Character.isWhitespace(s.charAt(i)) && s.charAt(i) != '>') i++;
                            value = s.substring(valueStart, i);
                        }
                    }
                    tag.attrs.putIfAbsent(name, decode(value));
                }
                tag.end = i;
                return tag;
            }
        }

        static void extract(Page page, String html) {
            String base = page.finalUrl;
            StringBuilder text = new StringBuilder();
            StringBuilder title = null;
            StringBuilder heading = null;
            StringBuilder linkText = null;
            int headingLevel = 0;
            String linkHref = null;
            boolean titleDone = false;
            String metaDescription = null;
            String ogDescription = null;
            Set<String> seenLinks = new HashSet<>();
            Set<String> seenImages = new HashSet<>();

            int n = html.length();
            int i = 0;
            while (i < n) {
                int lt = html.indexOf('<', i);
                if (lt < 0) {
                    append(html, i, n, text, title, heading, linkText);
                    break;
                }
                if (lt > i) append(html, i, lt, text, title, heading, linkText);
                i = lt;
                if (html.startsWith("<!--", i)) {
                    int end = html.indexOf("-->", i + 4);
                    i = end < 0 ? n : end + 3;
                    continue;
                }
                char next = i + 1 < n ? html.charAt(i + 1) : 0;
                if (next == '!' || next == '?') { // doctype, CDATA, processing instruction
                    int end = html.indexOf('>', i);
                    i = end < 0 ? n : end + 1;
                    continue;
                }
                Tag tag = Tag.parse(html, i);
                if (tag == null) { // a bare '<' in text, e.g. "a < b"
                    append("<", 0, 1, text, title, heading, linkText);
                    i++;
                    continue;
                }
                i = tag.end;
                append(" ", 0, 1, text, title, heading, linkText); // tags separate words

                if (tag.closing) {
                    switch (tag.name) {
                        case "title":
                            if (title != null) {
                                page.title = clean(decode(title));
                                title = null;
                            }
                            break;
                        case "h1": case "h2": case "h3":
                            if (heading != null) {
                                addHeading(page, headingLevel, heading);
                                heading = null;
                            }
                            break;
                        case "a":
                            if (linkText != null) {
                                addLink(page, base, linkHref, linkText, seenLinks);
                                linkText = null;
                                linkHref = null;
                            }
                            break;
                        default:
                            break;
                    }
                    continue;
                }

                if (RAW_TEXT.contains(tag.name)) { // skip scripts, styles and hidden templates entirely
                    int close = indexOfIgnoreCase(html, "</" + tag.name, i);
                    if (close < 0) {
                        i = n;
                    } else {
                        int gt = html.indexOf('>', close);
                        i = gt < 0 ? n : gt + 1;
                    }
                    continue;
                }
                switch (tag.name) {
                    case "title":
                        if (!titleDone) {
                            title = new StringBuilder();
                            titleDone = true;
                        }
                        break;
                    case "h1": case "h2": case "h3":
                        if (heading != null) addHeading(page, headingLevel, heading); // unterminated heading
                        heading = new StringBuilder();
                        headingLevel = tag.name.charAt(1) - '0';
                        break;
                    case "a":
                        if (linkText != null) addLink(page, base, linkHref, linkText, seenLinks); // unterminated link
                        linkHref = tag.attr("href");
                        linkText = linkHref != null ? new StringBuilder() : null;
                        break;
                    case "img": {
                        String src = tag.attr("src");
                        if (src == null || src.isBlank()) src = tag.attr("data-src");
                        if (src != null && !src.isBlank()) {
                            String resolved = Urls.resolve(base, src); // also drops inline data: URIs
                            if (resolved != null && seenImages.add(resolved)) {
                                page.images.add(new Link(resolved, clean(tag.attrs.getOrDefault("alt", ""))));
                            }
                        }
                        break;
                    }
                    case "meta": {
                        String name = tag.attr("name") != null ? tag.attr("name") : tag.attr("property");
                        String content = tag.attr("content");
                        if (name != null && content != null) {
                            name = name.trim().toLowerCase(Locale.ROOT);
                            if (name.equals("description") && metaDescription == null) metaDescription = clean(content);
                            else if (name.equals("og:description") && ogDescription == null) ogDescription = clean(content);
                        }
                        break;
                    }
                    case "base": {
                        String href = tag.attr("href");
                        String resolved = href != null ? Urls.resolve(page.finalUrl, href) : null;
                        if (resolved != null) base = resolved;
                        break;
                    }
                    default:
                        break;
                }
            }

            if (title != null) page.title = clean(decode(title));
            if (heading != null) addHeading(page, headingLevel, heading);
            if (linkText != null) addLink(page, base, linkHref, linkText, seenLinks);
            page.description = metaDescription != null ? metaDescription : ogDescription != null ? ogDescription : "";
            page.wordCount = countWords(decode(text));
        }

        private static void append(String s, int from, int to, StringBuilder text, StringBuilder title,
                                   StringBuilder heading, StringBuilder linkText) {
            text.append(s, from, to);
            if (title != null) title.append(s, from, to);
            if (heading != null) heading.append(s, from, to);
            if (linkText != null) linkText.append(s, from, to);
        }

        private static void addHeading(Page page, int level, StringBuilder raw) {
            String cleaned = clean(decode(raw));
            if (!cleaned.isEmpty()) page.headings.add(new Heading(level, cleaned));
        }

        private static void addLink(Page page, String base, String href, StringBuilder raw, Set<String> seen) {
            String resolved = Urls.resolve(base, href);
            if (resolved != null && seen.add(resolved)) {
                page.links.add(new Link(resolved, clean(decode(raw))));
            }
        }

        static int indexOfIgnoreCase(String haystack, String needle, int from) {
            for (int i = Math.max(from, 0); i + needle.length() <= haystack.length(); i++) {
                if (haystack.regionMatches(true, i, needle, 0, needle.length())) return i;
            }
            return -1;
        }

        /** Collapse runs of whitespace (including non-breaking spaces) into single spaces and trim. */
        static String clean(String s) {
            return WHITESPACE.matcher(s).replaceAll(" ").trim();
        }

        static int countWords(String s) {
            String cleaned = clean(s);
            return cleaned.isEmpty() ? 0 : cleaned.split(" ").length;
        }

        /** Windows-1252 code points for the C1 range, which browsers use for &#128;..&#159;. */
        static final int[] CP1252 = {
            0x20AC, 0xFFFD, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0xFFFD, 0x017D, 0xFFFD,
            0xFFFD, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0xFFFD, 0x017E, 0x0178,
        };

        /** The common named character references; numeric ones are handled generically. */
        static final Map<String, String> ENTITIES = Map.ofEntries(
            Map.entry("amp", "&"), Map.entry("lt", "<"), Map.entry("gt", ">"), Map.entry("quot", "\""),
            Map.entry("apos", "'"), Map.entry("nbsp", " "), Map.entry("copy", "\u00A9"), Map.entry("reg", "\u00AE"),
            Map.entry("trade", "\u2122"), Map.entry("hellip", "\u2026"), Map.entry("mdash", "\u2014"),
            Map.entry("ndash", "\u2013"), Map.entry("lsquo", "\u2018"), Map.entry("rsquo", "\u2019"),
            Map.entry("ldquo", "\u201C"), Map.entry("rdquo", "\u201D"), Map.entry("laquo", "\u00AB"),
            Map.entry("raquo", "\u00BB"), Map.entry("bull", "\u2022"), Map.entry("middot", "\u00B7"),
            Map.entry("euro", "\u20AC"), Map.entry("pound", "\u00A3"), Map.entry("yen", "\u00A5"),
            Map.entry("cent", "\u00A2"), Map.entry("deg", "\u00B0"), Map.entry("times", "\u00D7"),
            Map.entry("divide", "\u00F7"), Map.entry("plusmn", "\u00B1"), Map.entry("frac12", "\u00BD"),
            Map.entry("sect", "\u00A7"), Map.entry("para", "\u00B6"), Map.entry("shy", ""),
            Map.entry("agrave", "\u00E0"), Map.entry("aacute", "\u00E1"), Map.entry("acirc", "\u00E2"),
            Map.entry("atilde", "\u00E3"), Map.entry("auml", "\u00E4"), Map.entry("aring", "\u00E5"),
            Map.entry("aelig", "\u00E6"), Map.entry("ccedil", "\u00E7"), Map.entry("egrave", "\u00E8"),
            Map.entry("eacute", "\u00E9"), Map.entry("ecirc", "\u00EA"), Map.entry("euml", "\u00EB"),
            Map.entry("igrave", "\u00EC"), Map.entry("iacute", "\u00ED"), Map.entry("icirc", "\u00EE"),
            Map.entry("iuml", "\u00EF"), Map.entry("ntilde", "\u00F1"), Map.entry("ograve", "\u00F2"),
            Map.entry("oacute", "\u00F3"), Map.entry("ocirc", "\u00F4"), Map.entry("otilde", "\u00F5"),
            Map.entry("ouml", "\u00F6"), Map.entry("oslash", "\u00F8"), Map.entry("ugrave", "\u00F9"),
            Map.entry("uacute", "\u00FA"), Map.entry("ucirc", "\u00FB"), Map.entry("uuml", "\u00FC"),
            Map.entry("szlig", "\u00DF"), Map.entry("Agrave", "\u00C0"), Map.entry("Aacute", "\u00C1"),
            Map.entry("Auml", "\u00C4"), Map.entry("Ccedil", "\u00C7"), Map.entry("Eacute", "\u00C9"),
            Map.entry("Ntilde", "\u00D1"), Map.entry("Ouml", "\u00D6"), Map.entry("Uuml", "\u00DC"));

        /** Decode HTML character references; unknown ones are kept as written. */
        static String decode(CharSequence input) {
            String s = input.toString();
            if (s.indexOf('&') < 0) return s;
            StringBuilder out = new StringBuilder(s.length());
            int n = s.length();
            int i = 0;
            while (i < n) {
                char c = s.charAt(i);
                if (c != '&') {
                    out.append(c);
                    i++;
                    continue;
                }
                int semicolon = s.indexOf(';', i + 1);
                if (semicolon > i + 1 && semicolon - i <= 34) {
                    String name = s.substring(i + 1, semicolon);
                    String replacement = null;
                    if (name.charAt(0) == '#') {
                        try {
                            boolean hex = name.length() > 1 && (name.charAt(1) == 'x' || name.charAt(1) == 'X');
                            int cp = Integer.parseInt(name.substring(hex ? 2 : 1), hex ? 16 : 10);
                            if (cp >= 0x80 && cp <= 0x9F) cp = CP1252[cp - 0x80];
                            if (cp <= 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) cp = 0xFFFD;
                            replacement = new String(Character.toChars(cp));
                        } catch (NumberFormatException ignored) {
                            // not a number; keep the text as written
                        }
                    } else {
                        replacement = ENTITIES.get(name);
                    }
                    if (replacement != null) {
                        out.append(replacement);
                        i = semicolon + 1;
                        continue;
                    }
                }
                out.append('&');
                i++;
            }
            return out.toString();
        }
    }

    // -----------------------------------------------------------------------------------
    // JSON output (pretty-printed, two-space indent)
    // -----------------------------------------------------------------------------------
    static final class Json {
        static void write(Writer out, List<Page> pages) throws IOException {
            List<Object> rows = new ArrayList<>();
            for (Page page : pages) rows.add(page.toMap());
            writeValue(out, rows, 0);
            out.write("\n");
        }

        static void writeValue(Writer out, Object value, int indent) throws IOException {
            if (value == null) {
                out.write("null");
            } else if (value instanceof String) {
                writeString(out, (String) value);
            } else if (value instanceof Number || value instanceof Boolean) {
                out.write(value.toString());
            } else if (value instanceof Map) {
                Map<?, ?> map = (Map<?, ?>) value;
                if (map.isEmpty()) {
                    out.write("{}");
                    return;
                }
                out.write("{\n");
                boolean first = true;
                for (Map.Entry<?, ?> entry : map.entrySet()) {
                    if (!first) out.write(",\n");
                    first = false;
                    pad(out, indent + 2);
                    writeString(out, String.valueOf(entry.getKey()));
                    out.write(": ");
                    writeValue(out, entry.getValue(), indent + 2);
                }
                out.write("\n");
                pad(out, indent);
                out.write("}");
            } else if (value instanceof List) {
                List<?> list = (List<?>) value;
                if (list.isEmpty()) {
                    out.write("[]");
                    return;
                }
                out.write("[\n");
                boolean first = true;
                for (Object item : list) {
                    if (!first) out.write(",\n");
                    first = false;
                    pad(out, indent + 2);
                    writeValue(out, item, indent + 2);
                }
                out.write("\n");
                pad(out, indent);
                out.write("]");
            } else {
                writeString(out, value.toString());
            }
        }

        static void writeString(Writer out, String s) throws IOException {
            out.write('"');
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                switch (c) {
                    case '"': out.write("\\\""); break;
                    case '\\': out.write("\\\\"); break;
                    case '\n': out.write("\\n"); break;
                    case '\r': out.write("\\r"); break;
                    case '\t': out.write("\\t"); break;
                    default:
                        if (c < 0x20) out.write(String.format("\\u%04x", (int) c));
                        else out.write(c);
                }
            }
            out.write('"');
        }

        private static void pad(Writer out, int n) throws IOException {
            for (int i = 0; i < n; i++) out.write(' ');
        }
    }
}
