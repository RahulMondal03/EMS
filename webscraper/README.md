# Java Web Scraper

A breadth-first web crawler/scraper built on [jsoup](https://jsoup.org/).

For each page it extracts the **title**, **meta description**, **h1–h3 headings**, **links**,
**images**, and the text of any elements matching a **CSS selector** you provide. Results are
written as JSON or CSV.

Features:
- Crawl depth and page-count limits
- Stays on the starting domain by default
- Respects `robots.txt` (Allow/Disallow, `*` wildcards, `$` anchors)
- Polite delay between requests, configurable timeout and User-Agent
- URL normalization so the same page isn't scraped twice

## Build

Requires Java 17+ and Maven.

```bash
mvn package
```

This runs the tests and produces `target/webscraper-1.0.0-jar-with-dependencies.jar`.

## Usage

```bash
java -jar target/webscraper-1.0.0-jar-with-dependencies.jar <url> [options]
```

| Option | Description |
|---|---|
| `-d, --depth <n>` | Max link depth to follow (default 1; 0 = start page only) |
| `-m, --max-pages <n>` | Max pages to scrape (default 50) |
| `-s, --selector <css>` | CSS selector whose matching text to extract |
| `-o, --output <file>` | Write results to a file (default: stdout) |
| `-f, --format <fmt>` | `json` or `csv` (inferred from `--output` extension) |
| `--delay <ms>` | Delay between requests (default 500) |
| `--timeout <ms>` | Request timeout (default 10000) |
| `--user-agent <ua>` | Custom User-Agent |
| `--all-domains` | Follow links to other domains |
| `--ignore-robots` | Don't check robots.txt |

### Examples

```bash
# Scrape just one page and print JSON
java -jar target/webscraper-1.0.0-jar-with-dependencies.jar https://example.com -d 0

# Crawl two levels deep, grab all article titles, save as CSV
java -jar target/webscraper-1.0.0-jar-with-dependencies.jar https://news.ycombinator.com \
    -d 2 -m 30 -s ".titleline > a" -o output/results.csv
```

Progress is printed to stderr; data goes to stdout or the output file.

## Using it as a library

```java
ScraperConfig config = ScraperConfig.builder()
        .maxDepth(1)
        .maxPages(20)
        .cssSelector("h2.product-name")
        .build();

List<PageData> pages = new WebScraper(config).crawl("https://example.com");
for (PageData page : pages) {
    System.out.println(page.title() + " -> " + page.selected());
}
```

## Project layout

| File | Purpose |
|---|---|
| `Main.java` | Command-line parsing and output |
| `WebScraper.java` | Crawl loop, fetching, extraction, URL normalization |
| `ScraperConfig.java` | Crawl settings (builder) |
| `RobotsTxt.java` | robots.txt parser |
| `PageData.java` | Data extracted from one page |
| `ResultWriter.java` | JSON / CSV output |

Please scrape responsibly: check a site's terms of service and keep the request rate low.
