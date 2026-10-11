package com.example.scraper;

import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

/** Command-line entry point. Run with --help for usage. */
public final class Main {

    private static final String USAGE = """
            Usage: java -jar webscraper.jar <url> [options]

            Options:
              -d, --depth <n>        Max link depth to follow (default 1; 0 = start page only)
              -m, --max-pages <n>    Max pages to scrape (default 50)
              -s, --selector <css>   CSS selector whose matching text to extract (e.g. "p.price")
              -o, --output <file>    Write results to file (default: stdout)
              -f, --format <fmt>     json or csv (default json, or inferred from --output extension)
                  --delay <ms>       Delay between requests in ms (default 500)
                  --timeout <ms>     Request timeout in ms (default 10000)
                  --user-agent <ua>  Custom User-Agent header
                  --all-domains      Follow links to other domains
                  --ignore-robots    Do not check robots.txt
              -h, --help             Show this help
            """;

    public static void main(String[] args) {
        try {
            System.exit(run(args));
        } catch (IllegalArgumentException e) {
            System.err.println("Error: " + e.getMessage());
            System.err.println();
            System.err.print(USAGE);
            System.exit(2);
        }
    }

    static int run(String[] args) {
        if (args.length == 0) throw new IllegalArgumentException("missing <url>");

        String url = null;
        String output = null;
        String format = null;
        ScraperConfig.Builder builder = ScraperConfig.builder();

        for (int i = 0; i < args.length; i++) {
            String arg = args[i];
            switch (arg) {
                case "-h", "--help" -> {
                    System.out.print(USAGE);
                    return 0;
                }
                case "-d", "--depth" -> builder.maxDepth(intArg(args, ++i, arg));
                case "-m", "--max-pages" -> builder.maxPages(intArg(args, ++i, arg));
                case "-s", "--selector" -> builder.cssSelector(stringArg(args, ++i, arg));
                case "-o", "--output" -> output = stringArg(args, ++i, arg);
                case "-f", "--format" -> format = stringArg(args, ++i, arg).toLowerCase();
                case "--delay" -> builder.delay(Duration.ofMillis(intArg(args, ++i, arg)));
                case "--timeout" -> builder.timeout(Duration.ofMillis(intArg(args, ++i, arg)));
                case "--user-agent" -> builder.userAgent(stringArg(args, ++i, arg));
                case "--all-domains" -> builder.sameDomainOnly(false);
                case "--ignore-robots" -> builder.respectRobotsTxt(false);
                default -> {
                    if (arg.startsWith("-")) throw new IllegalArgumentException("unknown option " + arg);
                    if (url != null) throw new IllegalArgumentException("only one <url> may be given");
                    url = arg;
                }
            }
        }
        if (url == null) throw new IllegalArgumentException("missing <url>");
        if (!url.matches("(?i)^https?://.*")) url = "https://" + url;

        if (format == null) format = (output != null && output.toLowerCase().endsWith(".csv")) ? "csv" : "json";
        if (!format.equals("json") && !format.equals("csv")) {
            throw new IllegalArgumentException("format must be json or csv");
        }

        WebScraper scraper = new WebScraper(builder.build()).onPage(page -> System.err.printf(
                "[%d] depth=%d %s %s%n",
                page.statusCode(), page.depth(), page.url(),
                page.error() != null ? "-> " + page.error() : "\"" + page.title() + "\""));

        List<PageData> pages = scraper.crawl(url);
        System.err.printf("Scraped %d page(s).%n", pages.size());

        try {
            if (output == null) {
                Writer out = new OutputStreamWriter(System.out, StandardCharsets.UTF_8);
                write(pages, format, out);
            } else {
                Path path = Path.of(output);
                if (path.getParent() != null) Files.createDirectories(path.getParent());
                try (Writer out = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
                    write(pages, format, out);
                }
                System.err.println("Results written to " + path.toAbsolutePath());
            }
        } catch (IOException e) {
            System.err.println("Failed to write output: " + e.getMessage());
            return 1;
        }
        return 0;
    }

    private static void write(List<PageData> pages, String format, Writer out) throws IOException {
        if (format.equals("csv")) ResultWriter.writeCsv(pages, out);
        else ResultWriter.writeJson(pages, out);
    }

    private static String stringArg(String[] args, int i, String flag) {
        if (i >= args.length) throw new IllegalArgumentException(flag + " requires a value");
        return args[i];
    }

    private static int intArg(String[] args, int i, String flag) {
        try {
            return Integer.parseInt(stringArg(args, i, flag));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(flag + " requires a number");
        }
    }
}
