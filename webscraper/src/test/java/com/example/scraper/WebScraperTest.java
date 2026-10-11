package com.example.scraper;

import com.sun.net.httpserver.HttpServer;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.StringWriter;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class WebScraperTest {

    private static final Map<String, String> SITE = Map.of(
            "/", """
                    <html><head><title>Home</title><meta name="description" content="Test site"></head>
                    <body><h1>Welcome</h1><p class="price">$10</p>
                    <a href="/about">About</a> <a href="/private/secret">Secret</a>
                    <a href="https://other.example.com/">External</a> <img src="/logo.png"></body></html>
                    """,
            "/about", """
                    <html><head><title>About</title></head>
                    <body><h2>About us</h2><a href="/deep">Deep</a><a href="/#top">Home again</a></body></html>
                    """,
            "/deep", "<html><head><title>Deep</title></head><body></body></html>",
            "/private/secret", "<html><head><title>Secret</title></head><body></body></html>",
            "/robots.txt", "User-agent: *\nDisallow: /private/\n");

    private HttpServer server;
    private String base;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String body = SITE.get(exchange.getRequestURI().getPath());
            byte[] bytes = (body == null ? "not found" : body).getBytes(StandardCharsets.UTF_8);
            String type = exchange.getRequestURI().getPath().endsWith(".txt") ? "text/plain" : "text/html";
            exchange.getResponseHeaders().add("Content-Type", type + "; charset=utf-8");
            exchange.sendResponseHeaders(body == null ? 404 : 200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        base = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private ScraperConfig.Builder config() {
        return ScraperConfig.builder().delay(Duration.ZERO).timeout(Duration.ofSeconds(5));
    }

    @Test
    void extractsTitleHeadingsLinksImagesAndSelector() {
        Document doc = Jsoup.parse(SITE.get("/"), "https://example.com/");
        PageData page = WebScraper.extract(doc, "https://example.com/", 200, 0, ".price");

        assertEquals("Home", page.title());
        assertEquals("Test site", page.description());
        assertEquals(List.of("Welcome"), page.headings());
        assertEquals(List.of("https://example.com/about", "https://example.com/private/secret",
                "https://other.example.com/"), page.links());
        assertEquals(List.of("https://example.com/logo.png"), page.images());
        assertEquals(List.of("$10"), page.selected());
    }

    @Test
    void crawlsBreadthFirstRespectingDepthDomainAndRobots() {
        List<PageData> pages = new WebScraper(config().maxDepth(2).build()).crawl(base + "/");
        List<String> urls = pages.stream().map(PageData::url).toList();

        assertEquals(List.of(base + "/", base + "/about", base + "/private/secret", base + "/deep"), urls);
        assertEquals("Disallowed by robots.txt", pages.get(2).error());
        assertEquals("Deep", pages.get(3).title());
        assertEquals(2, pages.get(3).depth());
    }

    @Test
    void depthZeroScrapesOnlyStartPage() {
        List<PageData> pages = new WebScraper(config().maxDepth(0).build()).crawl(base);
        assertEquals(1, pages.size());
        assertEquals(base + "/", pages.get(0).url());
    }

    @Test
    void maxPagesLimitsCrawl() {
        List<PageData> pages = new WebScraper(config().maxDepth(5).maxPages(2).build()).crawl(base + "/");
        assertEquals(2, pages.size());
    }

    @Test
    void reportsHttpErrors() {
        PageData page = new WebScraper(config().build()).scrape(base + "/missing", 0);
        assertEquals(404, page.statusCode());
        assertEquals("HTTP 404", page.error());
    }

    @Test
    void normalizesUrls() {
        assertEquals("https://example.com/", WebScraper.normalize("HTTPS://Example.COM"));
        assertEquals("https://example.com/a?b=1", WebScraper.normalize("https://example.com:443/x/../a?b=1#frag"));
        assertNull(WebScraper.normalize("mailto:someone@example.com"));
        assertNull(WebScraper.normalize("javascript:void(0)"));
    }

    @Test
    void robotsLongestMatchWins() {
        RobotsTxt robots = RobotsTxt.parse("""
                User-agent: *
                Disallow: /private/
                Allow: /private/public
                Disallow: /*.pdf$
                """, ScraperConfig.DEFAULT_USER_AGENT);
        assertTrue(robots.isAllowed("/"));
        assertFalse(robots.isAllowed("/private/x"));
        assertTrue(robots.isAllowed("/private/public/page"));
        assertFalse(robots.isAllowed("/docs/file.pdf"));
        assertTrue(robots.isAllowed("/docs/file.pdf?x=1"));
    }

    @Test
    void writesEscapedJsonAndCsv() throws IOException {
        PageData page = new PageData("https://e.com/", 200, 0, "Say \"hi\", ok", "", List.of("a\nb"),
                List.of(), List.of(), List.of(), null);

        StringWriter json = new StringWriter();
        ResultWriter.writeJson(List.of(page), json);
        assertTrue(json.toString().contains("\"title\": \"Say \\\"hi\\\", ok\""));
        assertTrue(json.toString().contains("\"headings\": [\"a\\nb\"]"));

        StringWriter csv = new StringWriter();
        ResultWriter.writeCsv(List.of(page), csv);
        assertTrue(csv.toString().contains("\"Say \"\"hi\"\", ok\""));
    }
}
