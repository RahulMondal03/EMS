package com.example.scraper;

import org.jsoup.Connection;
import org.jsoup.HttpStatusException;
import org.jsoup.Jsoup;
import org.jsoup.UnsupportedMimeTypeException;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/**
 * Breadth-first web crawler/scraper built on jsoup.
 */
public class WebScraper {

    private final ScraperConfig config;
    private final Map<String, RobotsTxt> robotsCache = new HashMap<>();
    private Consumer<PageData> listener = page -> {};

    public WebScraper(ScraperConfig config) {
        this.config = config;
    }

    /** Called after each page is scraped, e.g. for progress output. */
    public WebScraper onPage(Consumer<PageData> listener) {
        this.listener = listener;
        return this;
    }

    /** Crawls starting at {@code startUrl} and returns data for every visited page. */
    public List<PageData> crawl(String startUrl) {
        String start = normalize(startUrl);
        if (start == null) throw new IllegalArgumentException("Invalid URL: " + startUrl);
        String startHost = URI.create(start).getHost();

        record Task(String url, int depth) {}
        Deque<Task> queue = new ArrayDeque<>();
        Set<String> seen = new HashSet<>();
        List<PageData> results = new ArrayList<>();

        queue.add(new Task(start, 0));
        seen.add(start);

        while (!queue.isEmpty() && results.size() < config.maxPages()) {
            Task task = queue.poll();

            if (config.respectRobotsTxt() && !isAllowedByRobots(task.url())) {
                PageData skipped = PageData.failed(task.url(), task.depth(), -1, "Disallowed by robots.txt");
                results.add(skipped);
                listener.accept(skipped);
                continue;
            }

            PageData page = scrape(task.url(), task.depth());
            results.add(page);
            listener.accept(page);

            if (task.depth() < config.maxDepth()) {
                for (String link : page.links()) {
                    if (config.sameDomainOnly() && !sameHost(startHost, link)) continue;
                    if (seen.add(link)) queue.add(new Task(link, task.depth() + 1));
                }
            }

            if (!queue.isEmpty()) sleep(config.delay().toMillis());
        }
        return results;
    }

    /** Fetches and parses a single page. Never throws; failures are reported in {@link PageData#error()}. */
    public PageData scrape(String url, int depth) {
        try {
            Connection.Response response = connect(url).execute();
            Document doc = response.parse();
            return extract(doc, url, response.statusCode(), depth, config.cssSelector());
        } catch (HttpStatusException e) {
            return PageData.failed(url, depth, e.getStatusCode(), "HTTP " + e.getStatusCode());
        } catch (UnsupportedMimeTypeException e) {
            return PageData.failed(url, depth, -1, "Unsupported content type: " + e.getMimeType());
        } catch (IOException | IllegalArgumentException e) {
            return PageData.failed(url, depth, -1, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** Extracts data from an already-parsed document. Public so it can be unit-tested without network. */
    public static PageData extract(Document doc, String url, int statusCode, int depth, String cssSelector) {
        List<String> headings = doc.select("h1, h2, h3").eachText();

        Set<String> links = new LinkedHashSet<>();
        for (Element a : doc.select("a[href]")) {
            String normalized = normalize(a.absUrl("href"));
            if (normalized != null) links.add(normalized);
        }

        Set<String> images = new LinkedHashSet<>();
        for (Element img : doc.select("img[src]")) {
            String src = img.absUrl("src");
            if (!src.isEmpty()) images.add(src);
        }

        List<String> selected = (cssSelector == null || cssSelector.isBlank())
                ? List.of()
                : doc.select(cssSelector).eachText();

        String description = doc.select("meta[name=description]").attr("content");

        return new PageData(url, statusCode, depth, doc.title(), description,
                headings, List.copyOf(links), List.copyOf(images), selected, null);
    }

    /**
     * Normalizes a URL for de-duplication: http(s) only, fragment removed,
     * scheme/host lower-cased, empty path becomes "/". Returns null for unusable URLs.
     */
    static String normalize(String url) {
        if (url == null || url.isBlank()) return null;
        try {
            URI uri = new URI(url.trim()).normalize();
            String scheme = uri.getScheme();
            if (scheme == null || uri.getHost() == null) return null;
            scheme = scheme.toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return null;
            String path = (uri.getRawPath() == null || uri.getRawPath().isEmpty()) ? "/" : uri.getRawPath();
            int port = uri.getPort();
            boolean defaultPort = port == -1
                    || (scheme.equals("http") && port == 80)
                    || (scheme.equals("https") && port == 443);
            return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT)
                    + (defaultPort ? "" : ":" + port)
                    + path
                    + (uri.getRawQuery() != null ? "?" + uri.getRawQuery() : "");
        } catch (URISyntaxException e) {
            return null;
        }
    }

    private Connection connect(String url) {
        return Jsoup.connect(url)
                .userAgent(config.userAgent())
                .timeout((int) config.timeout().toMillis())
                .followRedirects(true);
    }

    private boolean isAllowedByRobots(String url) {
        URI uri = URI.create(url);
        String origin = uri.getScheme() + "://" + uri.getRawAuthority();
        RobotsTxt robots = robotsCache.computeIfAbsent(origin, this::fetchRobots);
        String path = uri.getRawPath() + (uri.getRawQuery() != null ? "?" + uri.getRawQuery() : "");
        return robots.isAllowed(path);
    }

    private RobotsTxt fetchRobots(String origin) {
        try {
            String body = connect(origin + "/robots.txt").ignoreContentType(true).execute().body();
            return RobotsTxt.parse(body, config.userAgent());
        } catch (IOException e) {
            return RobotsTxt.allowAll(); // missing/unreachable robots.txt means no restrictions
        }
    }

    private static boolean sameHost(String host, String url) {
        String other = URI.create(url).getHost();
        return other != null && (other.equalsIgnoreCase(host)
                || other.equalsIgnoreCase("www." + host)
                || host.equalsIgnoreCase("www." + other));
    }

    private static void sleep(long millis) {
        if (millis <= 0) return;
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
