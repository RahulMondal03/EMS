# Web scraper

The same small, polite web scraper written three times: in Python, C and Java.
Point any of them at one or more URLs and it records, for every page:

- title and meta description
- h1–h3 headings
- links (absolute URLs plus anchor text) and images (URL plus alt text)
- a visible-word count
- HTTP status, final URL after redirects and the time it was fetched

Optionally it crawls same-site links breadth-first to a chosen depth. All three
honour `robots.txt` (including `Crawl-delay`), send an identifying User-Agent,
pause between requests, retry network errors and HTTP 429/5xx with exponential
backoff, cap the bytes read per page, and report per-page failures in an
`error` field instead of aborting the run. Output is a JSON array with the same
shape in every language. Only scrape sites whose terms allow it.

## Python — `webscraper.py`

Needs Python 3.9+ plus `requests` and `beautifulsoup4`:

```sh
pip install requests beautifulsoup4
python webscraper.py https://example.com
python webscraper.py https://example.com --depth 1 --max-pages 25 -o site.json
python webscraper.py https://example.com -s "h2.title" -s "a.btn@href"   # CSS selectors
python webscraper.py https://example.com --depth 1 -o pages.csv          # CSV output
```

The Python version is the most featureful: `--select` extracts anything a CSS
selector matches (`selector@attr` reads an attribute), and it can write JSON,
JSON Lines or CSV. Run `python webscraper.py --help` for every option.

## C — `webscraper.c`

Needs libcurl 7.62+ with its development headers (`libcurl4-openssl-dev` on
Debian/Ubuntu, `curl` from Homebrew on macOS):

```sh
cc -O2 -Wall -Wextra -o webscraper webscraper.c $(pkg-config --cflags --libs libcurl)
./webscraper https://example.com
./webscraper https://example.com --depth 1 --max-pages 25 -o site.json
```

## Java — `WebScraper.java`

Needs Java 11+ and nothing else:

```sh
javac WebScraper.java && java WebScraper https://example.com
java WebScraper.java https://example.com --depth 1 --max-pages 25 -o site.json   # run from source
```

## Common options

| Option | Meaning | Default |
|---|---|---|
| `-o, --output FILE` | write results to a file instead of stdout | stdout |
| `-d, --depth N` | follow links N levels deep (0 = only the given URLs) | 0 |
| `-m, --max-pages N` | stop after fetching N pages | 50 |
| `--delay SECONDS` | minimum pause between requests | 1 |
| `--timeout SECONDS` | per-request timeout | 15 |
| `--retries N` | retries for network errors and HTTP 429/5xx | 2 |
| `--max-bytes N` | read at most N bytes per page | 5000000 |
| `--user-agent STRING` | User-Agent header to send | `ems-webscraper/1.0` |
| `--allow-external` | when crawling, also follow links to other sites | off |
| `--ignore-robots` | skip `robots.txt` (only for sites you own) | off |
| `-q, --quiet` | only report errors | off |

The C and Java versions use a small built-in HTML tokenizer instead of a parser
library, so they do not offer CSS selectors or CSV output. Everything else
behaves the same, and the JSON they produce has the same fields and values as
the Python version's (which adds one extra field, `selections`, for `--select`).
