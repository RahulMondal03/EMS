/*
 * webscraper.c - a small, polite web scraper in C, built on libcurl.
 *
 * Build (needs the libcurl development package, e.g. libcurl4-openssl-dev on Debian/Ubuntu,
 * "curl" on Homebrew):
 *     cc -O2 -Wall -Wextra -o webscraper webscraper.c $(pkg-config --cflags --libs libcurl)
 * or simply:
 *     cc -O2 -o webscraper webscraper.c -lcurl
 *
 * Run:
 *     ./webscraper https://example.com
 *     ./webscraper https://example.com --depth 1 --max-pages 25 --output site.json
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
 *
 * Needs libcurl 7.62 or newer (for its URL API) on a POSIX system. Pages declared as
 * ISO-8859-1 / Windows-1252 are converted to UTF-8; everything else is treated as UTF-8 and
 * invalid bytes are replaced on output, so the JSON is always valid.
 */
#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <errno.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>

#include <curl/curl.h>

#define DEFAULT_USER_AGENT "ems-webscraper/1.0 (+https://github.com/rahulmondal03/ems)"
#define MAX_RETRY_WAIT 60.0
#define MAX_ATTRS 32

static bool g_quiet = false;

/* ------------------------------------------------------------------------------------ */
/* Logging and memory                                                                    */
/* ------------------------------------------------------------------------------------ */
static void logmsg(const char *level, const char *fmt, va_list ap)
{
    fprintf(stderr, "%s: ", level);
    vfprintf(stderr, fmt, ap);
    fputc('\n', stderr);
}

static void info(const char *fmt, ...)
{
    if (g_quiet) return;
    va_list ap;
    va_start(ap, fmt);
    logmsg("INFO", fmt, ap);
    va_end(ap);
}

static void warning(const char *fmt, ...)
{
    if (g_quiet) return;
    va_list ap;
    va_start(ap, fmt);
    logmsg("WARNING", fmt, ap);
    va_end(ap);
}

static void die(const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    logmsg("error", fmt, ap);
    va_end(ap);
    fputs("Run with --help for usage.\n", stderr);
    exit(2);
}

static void *xmalloc(size_t n)
{
    void *p = malloc(n ? n : 1);
    if (!p) {
        fputs("out of memory\n", stderr);
        exit(1);
    }
    return p;
}

static void *xrealloc(void *p, size_t n)
{
    p = realloc(p, n ? n : 1);
    if (!p) {
        fputs("out of memory\n", stderr);
        exit(1);
    }
    return p;
}

static char *xstrndup(const char *s, size_t n)
{
    char *d = xmalloc(n + 1);
    memcpy(d, s, n);
    d[n] = '\0';
    return d;
}

static char *xstrdup(const char *s)
{
    return xstrndup(s, strlen(s));
}

/* Growable, always NUL-terminated byte buffer. */
typedef struct {
    char *data;
    size_t len, cap;
} Buf;

static void buf_init(Buf *b)
{
    b->data = NULL;
    b->len = b->cap = 0;
}

static void buf_append(Buf *b, const char *s, size_t n)
{
    if (b->len + n + 1 > b->cap) {
        size_t cap = b->cap ? b->cap : 256;
        while (cap < b->len + n + 1) cap *= 2;
        b->data = xrealloc(b->data, cap);
        b->cap = cap;
    }
    memcpy(b->data + b->len, s, n);
    b->len += n;
    b->data[b->len] = '\0';
}

static void buf_putc(Buf *b, char c)
{
    buf_append(b, &c, 1);
}

static void buf_puts(Buf *b, const char *s)
{
    buf_append(b, s, strlen(s));
}

static const char *buf_str(const Buf *b)
{
    return b->data ? b->data : "";
}

/* Hand the buffer's string to the caller (never NULL) and reset the buffer. */
static char *buf_detach(Buf *b)
{
    char *s = b->data ? b->data : xstrdup("");
    buf_init(b);
    return s;
}

static void buf_free(Buf *b)
{
    free(b->data);
    buf_init(b);
}

/* List of owned strings; doubles as a (linear) set. */
typedef struct {
    char **items;
    size_t len, cap;
} StrList;

static void strlist_push(StrList *l, char *s)
{
    if (l->len == l->cap) {
        l->cap = l->cap ? l->cap * 2 : 16;
        l->items = xrealloc(l->items, l->cap * sizeof *l->items);
    }
    l->items[l->len++] = s;
}

static bool strlist_contains(const StrList *l, const char *s)
{
    for (size_t i = 0; i < l->len; i++) {
        if (strcmp(l->items[i], s) == 0) return true;
    }
    return false;
}

static void strlist_free(StrList *l)
{
    for (size_t i = 0; i < l->len; i++) free(l->items[i]);
    free(l->items);
    memset(l, 0, sizeof *l);
}

/* ------------------------------------------------------------------------------------ */
/* Small string helpers                                                                  */
/* ------------------------------------------------------------------------------------ */
static char *str_lower(char *s)
{
    for (char *p = s; *p; p++) *p = (char)tolower((unsigned char)*p);
    return s;
}

static char *trim(char *s)
{
    while (*s && isspace((unsigned char)*s)) s++;
    size_t n = strlen(s);
    while (n > 0 && isspace((unsigned char)s[n - 1])) s[--n] = '\0';
    return s;
}

/* Bytes of whitespace at p: 1 for ASCII whitespace, 2 for a UTF-8 no-break space, else 0. */
static int space_len(const char *p)
{
    if (isspace((unsigned char)p[0])) return 1;
    if ((unsigned char)p[0] == 0xC2 && (unsigned char)p[1] == 0xA0) return 2;
    return 0;
}

/* Collapse whitespace runs into single spaces and trim, in place. */
static void clean_whitespace(char *s)
{
    char *out = s;
    bool pending_space = false;
    for (const char *p = s; *p;) {
        int n = space_len(p);
        if (n) {
            pending_space = out != s;
            p += n;
        } else {
            if (pending_space) *out++ = ' ';
            pending_space = false;
            *out++ = *p++;
        }
    }
    *out = '\0';
}

static long find_char(const char *hay, size_t n, size_t from, char c)
{
    if (from >= n) return -1;
    const char *p = memchr(hay + from, c, n - from);
    return p ? (long)(p - hay) : -1;
}

static long find_str(const char *hay, size_t n, size_t from, const char *needle)
{
    size_t m = strlen(needle);
    for (size_t i = from; i + m <= n; i++) {
        if (memcmp(hay + i, needle, m) == 0) return (long)i;
    }
    return -1;
}

static long find_ci(const char *hay, size_t n, size_t from, const char *needle)
{
    size_t m = strlen(needle);
    for (size_t i = from; i + m <= n; i++) {
        if (strncasecmp(hay + i, needle, m) == 0) return (long)i;
    }
    return -1;
}

static void now_iso8601(char out[32])
{
    time_t t = time(NULL);
    struct tm tm;
    gmtime_r(&t, &tm);
    strftime(out, 32, "%Y-%m-%dT%H:%M:%SZ", &tm);
}

static double monotonic_seconds(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

static void sleep_seconds(double seconds)
{
    if (seconds <= 0) return;
    struct timespec ts;
    ts.tv_sec = (time_t)seconds;
    ts.tv_nsec = (long)((seconds - (double)ts.tv_sec) * 1e9);
    while (nanosleep(&ts, &ts) == -1 && errno == EINTR) {
        /* interrupted by a signal: keep sleeping for the remainder */
    }
}

/* ------------------------------------------------------------------------------------ */
/* Text encoding: entities, Latin-1 and UTF-8                                            */
/* ------------------------------------------------------------------------------------ */
/* Windows-1252 code points for 0x80..0x9F, which browsers also use for &#128;..&#159;. */
static const uint16_t CP1252[32] = {
    0x20AC, 0xFFFD, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0xFFFD, 0x017D, 0xFFFD,
    0xFFFD, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0xFFFD, 0x017E, 0x0178,
};

static void buf_put_utf8(Buf *b, uint32_t cp)
{
    char tmp[4];
    int n;
    if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF) || cp == 0) cp = 0xFFFD;
    if (cp < 0x80) {
        tmp[0] = (char)cp;
        n = 1;
    } else if (cp < 0x800) {
        tmp[0] = (char)(0xC0 | (cp >> 6));
        tmp[1] = (char)(0x80 | (cp & 0x3F));
        n = 2;
    } else if (cp < 0x10000) {
        tmp[0] = (char)(0xE0 | (cp >> 12));
        tmp[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
        tmp[2] = (char)(0x80 | (cp & 0x3F));
        n = 3;
    } else {
        tmp[0] = (char)(0xF0 | (cp >> 18));
        tmp[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
        tmp[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
        tmp[3] = (char)(0x80 | (cp & 0x3F));
        n = 4;
    }
    buf_append(b, tmp, (size_t)n);
}

/* The common named character references; numeric ones are handled generically. */
static const struct {
    const char *name;
    const char *utf8;
} ENTITIES[] = {
    {"amp", "&"}, {"lt", "<"}, {"gt", ">"}, {"quot", "\""}, {"apos", "'"}, {"nbsp", " "},
    {"copy", "\xC2\xA9"}, {"reg", "\xC2\xAE"}, {"trade", "\xE2\x84\xA2"}, {"hellip", "\xE2\x80\xA6"},
    {"mdash", "\xE2\x80\x94"}, {"ndash", "\xE2\x80\x93"}, {"lsquo", "\xE2\x80\x98"}, {"rsquo", "\xE2\x80\x99"},
    {"ldquo", "\xE2\x80\x9C"}, {"rdquo", "\xE2\x80\x9D"}, {"laquo", "\xC2\xAB"}, {"raquo", "\xC2\xBB"},
    {"bull", "\xE2\x80\xA2"}, {"middot", "\xC2\xB7"}, {"euro", "\xE2\x82\xAC"}, {"pound", "\xC2\xA3"},
    {"yen", "\xC2\xA5"}, {"cent", "\xC2\xA2"}, {"deg", "\xC2\xB0"}, {"times", "\xC3\x97"},
    {"divide", "\xC3\xB7"}, {"plusmn", "\xC2\xB1"}, {"frac12", "\xC2\xBD"}, {"sect", "\xC2\xA7"},
    {"para", "\xC2\xB6"}, {"shy", ""},
    {"agrave", "\xC3\xA0"}, {"aacute", "\xC3\xA1"}, {"acirc", "\xC3\xA2"}, {"atilde", "\xC3\xA3"},
    {"auml", "\xC3\xA4"}, {"aring", "\xC3\xA5"}, {"aelig", "\xC3\xA6"}, {"ccedil", "\xC3\xA7"},
    {"egrave", "\xC3\xA8"}, {"eacute", "\xC3\xA9"}, {"ecirc", "\xC3\xAA"}, {"euml", "\xC3\xAB"},
    {"igrave", "\xC3\xAC"}, {"iacute", "\xC3\xAD"}, {"icirc", "\xC3\xAE"}, {"iuml", "\xC3\xAF"},
    {"ntilde", "\xC3\xB1"}, {"ograve", "\xC3\xB2"}, {"oacute", "\xC3\xB3"}, {"ocirc", "\xC3\xB4"},
    {"otilde", "\xC3\xB5"}, {"ouml", "\xC3\xB6"}, {"oslash", "\xC3\xB8"}, {"ugrave", "\xC3\xB9"},
    {"uacute", "\xC3\xBA"}, {"ucirc", "\xC3\xBB"}, {"uuml", "\xC3\xBC"}, {"szlig", "\xC3\x9F"},
    {"Agrave", "\xC3\x80"}, {"Aacute", "\xC3\x81"}, {"Auml", "\xC3\x84"}, {"Ccedil", "\xC3\x87"},
    {"Eacute", "\xC3\x89"}, {"Ntilde", "\xC3\x91"}, {"Ouml", "\xC3\x96"}, {"Uuml", "\xC3\x9C"},
};

/* Decode HTML character references in s[0..n) into a new string; unknown ones are kept. */
static char *decode_entities(const char *s, size_t n)
{
    Buf out;
    buf_init(&out);
    size_t i = 0;
    while (i < n) {
        if (s[i] != '&') {
            buf_putc(&out, s[i++]);
            continue;
        }
        size_t end = i + 1;
        while (end < n && end - i <= 34 && (isalnum((unsigned char)s[end]) || s[end] == '#')) end++;
        if (end < n && s[end] == ';' && end > i + 1) {
            const char *name = s + i + 1;
            size_t len = end - i - 1;
            bool replaced = false;
            if (name[0] == '#') {
                uint32_t cp = 0;
                bool hex = len > 1 && (name[1] == 'x' || name[1] == 'X');
                size_t k = hex ? 2 : 1;
                bool ok = k < len;
                for (; k < len && ok; k++) {
                    unsigned char c = (unsigned char)name[k];
                    if (hex && isxdigit(c)) {
                        cp = cp * 16 + (uint32_t)(isdigit(c) ? c - '0' : tolower(c) - 'a' + 10);
                    } else if (!hex && isdigit(c)) {
                        cp = cp * 10 + (uint32_t)(c - '0');
                    } else {
                        ok = false;
                    }
                    if (cp > 0x10FFFF) cp = 0x110000; /* clamp so it cannot overflow */
                }
                if (ok) {
                    if (cp >= 0x80 && cp <= 0x9F) cp = CP1252[cp - 0x80];
                    buf_put_utf8(&out, cp);
                    replaced = true;
                }
            } else {
                for (size_t e = 0; e < sizeof ENTITIES / sizeof ENTITIES[0]; e++) {
                    if (strlen(ENTITIES[e].name) == len && strncmp(ENTITIES[e].name, name, len) == 0) {
                        buf_puts(&out, ENTITIES[e].utf8);
                        replaced = true;
                        break;
                    }
                }
            }
            if (replaced) {
                i = end + 1;
                continue;
            }
        }
        buf_putc(&out, '&');
        i++;
    }
    return buf_detach(&out);
}

/* Charset named in the Content-Type header or in a <meta> tag within the first 4 KB. */
static char *charset_after(const char *s, size_t n, size_t pos)
{
    while (pos < n && (s[pos] == '"' || s[pos] == '\'' || isspace((unsigned char)s[pos]))) pos++;
    size_t start = pos;
    while (pos < n && (isalnum((unsigned char)s[pos]) || strchr("-_.:", s[pos]))) pos++;
    if (pos == start) return NULL;
    return str_lower(xstrndup(s + start, pos - start));
}

static char *detect_charset(const char *content_type, const char *body, size_t n)
{
    if (content_type) {
        size_t len = strlen(content_type);
        long p = find_ci(content_type, len, 0, "charset=");
        if (p >= 0) {
            char *cs = charset_after(content_type, len, (size_t)p + 8);
            if (cs) return cs;
        }
    }
    size_t limit = n < 4096 ? n : 4096;
    long p = find_ci(body, limit, 0, "charset=");
    return p >= 0 ? charset_after(body, limit, (size_t)p + 8) : NULL;
}

/* Return a UTF-8 copy of body: Latin-1 / Windows-1252 are converted, anything else copied. */
static char *to_utf8(const char *body, size_t n, const char *charset, size_t *out_len)
{
    static const char *const latin[] = {"iso-8859-1", "iso8859-1", "latin1", "latin-1", "windows-1252",
                                        "cp1252", "iso-8859-15", "us-ascii", "ascii", NULL};
    bool is_latin = false;
    for (int i = 0; charset && latin[i]; i++) {
        if (strcmp(charset, latin[i]) == 0) is_latin = true;
    }
    if (!is_latin) {
        *out_len = n;
        return xstrndup(body, n);
    }
    Buf b;
    buf_init(&b);
    for (size_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)body[i];
        if (c < 0x80) buf_putc(&b, (char)c);
        else if (c < 0xA0) buf_put_utf8(&b, CP1252[c - 0x80]);
        else buf_put_utf8(&b, c);
    }
    *out_len = b.len;
    return buf_detach(&b);
}

/* Length of the valid UTF-8 sequence at p, or 0 if it is invalid. */
static int utf8_sequence_length(const unsigned char *p)
{
    unsigned char c = p[0];
    int len;
    uint32_t cp;
    if (c >= 0xC2 && c <= 0xDF) {
        len = 2;
        cp = c & 0x1F;
    } else if (c >= 0xE0 && c <= 0xEF) {
        len = 3;
        cp = c & 0x0F;
    } else if (c >= 0xF0 && c <= 0xF4) {
        len = 4;
        cp = c & 0x07;
    } else {
        return 0;
    }
    for (int i = 1; i < len; i++) {
        if ((p[i] & 0xC0) != 0x80) return 0; /* also stops at the NUL terminator */
        cp = (cp << 6) | (p[i] & 0x3F);
    }
    if ((len == 3 && cp < 0x800) || (len == 4 && (cp < 0x10000 || cp > 0x10FFFF))) return 0;
    if (cp >= 0xD800 && cp <= 0xDFFF) return 0;
    return len;
}

/* ------------------------------------------------------------------------------------ */
/* Data model                                                                            */
/* ------------------------------------------------------------------------------------ */
typedef struct {
    char *url;
    char *text; /* anchor text, or the alt text for images */
} Link;

typedef struct {
    Link *items;
    size_t len, cap;
} LinkList;

typedef struct {
    int level;
    char *text;
} Heading;

typedef struct {
    Heading *items;
    size_t len, cap;
} HeadingList;

/* Everything extracted from one URL; error is set when it failed. */
typedef struct {
    char *url;
    int depth;
    char *final_url;
    long status;
    char *content_type;
    char fetched_at[32];
    char *title;
    char *description;
    HeadingList headings;
    LinkList links;
    LinkList images;
    long word_count;
    char *error;
} Page;

static bool linklist_has_url(const LinkList *l, const char *url)
{
    for (size_t i = 0; i < l->len; i++) {
        if (strcmp(l->items[i].url, url) == 0) return true;
    }
    return false;
}

/* Takes ownership of url and text. */
static void linklist_add(LinkList *l, char *url, char *text)
{
    if (l->len == l->cap) {
        l->cap = l->cap ? l->cap * 2 : 16;
        l->items = xrealloc(l->items, l->cap * sizeof *l->items);
    }
    l->items[l->len].url = url;
    l->items[l->len].text = text;
    l->len++;
}

static void linklist_free(LinkList *l)
{
    for (size_t i = 0; i < l->len; i++) {
        free(l->items[i].url);
        free(l->items[i].text);
    }
    free(l->items);
    memset(l, 0, sizeof *l);
}

static void headinglist_add(HeadingList *l, int level, char *text)
{
    if (l->len == l->cap) {
        l->cap = l->cap ? l->cap * 2 : 8;
        l->items = xrealloc(l->items, l->cap * sizeof *l->items);
    }
    l->items[l->len].level = level;
    l->items[l->len].text = text;
    l->len++;
}

static void page_init(Page *p, const char *url, int depth)
{
    memset(p, 0, sizeof *p);
    p->url = xstrdup(url);
    p->depth = depth;
    p->final_url = xstrdup("");
    p->content_type = xstrdup("");
    p->title = xstrdup("");
    p->description = xstrdup("");
}

static void page_free(Page *p)
{
    free(p->url);
    free(p->final_url);
    free(p->content_type);
    free(p->title);
    free(p->description);
    for (size_t i = 0; i < p->headings.len; i++) free(p->headings.items[i].text);
    free(p->headings.items);
    linklist_free(&p->links);
    linklist_free(&p->images);
    free(p->error);
    memset(p, 0, sizeof *p);
}

static void page_set_error(Page *p, const char *fmt, ...)
{
    char msg[1024];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    free(p->error);
    p->error = xstrdup(msg);
}

/* ------------------------------------------------------------------------------------ */
/* URL helpers (libcurl's URL API does the parsing and relative resolution)              */
/* ------------------------------------------------------------------------------------ */
static unsigned int url_flags(void)
{
    unsigned int flags = 0;
#ifdef CURLU_ALLOW_SPACE
    flags |= CURLU_ALLOW_SPACE;
#endif
    return flags;
}

static bool is_http_scheme(const char *scheme)
{
    return scheme && (strcasecmp(scheme, "http") == 0 || strcasecmp(scheme, "https") == 0);
}

/* Resolve ref against base and drop the fragment; NULL unless the result is http(s). */
static char *resolve_url(const char *base, const char *ref)
{
    CURLU *h = curl_url();
    if (!h) return NULL;
    char *scheme = NULL, *out = NULL, *result = NULL;
    char *copy = xstrdup(ref);
    const char *target = trim(copy);
    /* An empty or fragment-only reference means "this page"; libcurl would drop the base path. */
    if (*target == '#') target = "";
    bool ok = curl_url_set(h, CURLUPART_URL, base, url_flags()) == CURLUE_OK;
    if (ok && *target) ok = curl_url_set(h, CURLUPART_URL, target, url_flags()) == CURLUE_OK;
    if (ok) ok = curl_url_set(h, CURLUPART_FRAGMENT, NULL, 0) == CURLUE_OK;
    if (ok) ok = curl_url_get(h, CURLUPART_SCHEME, &scheme, 0) == CURLUE_OK && is_http_scheme(scheme);
    if (ok && curl_url_get(h, CURLUPART_URL, &out, 0) == CURLUE_OK) result = xstrdup(out);
    curl_free(scheme);
    curl_free(out);
    curl_url_cleanup(h);
    free(copy);
    return result;
}

/* Canonical form for duplicate detection, or NULL if not a valid http(s) URL: lower-case
 * scheme and host, default port dropped, fragment removed, empty path turned into "/". */
static char *normalize_url(const char *url)
{
    CURLU *h = curl_url();
    if (!h) return NULL;
    char *scheme = NULL, *host = NULL, *port = NULL, *path = NULL, *query = NULL, *user = NULL, *result = NULL;
    if (curl_url_set(h, CURLUPART_URL, url, url_flags()) == CURLUE_OK &&
        curl_url_get(h, CURLUPART_SCHEME, &scheme, 0) == CURLUE_OK && is_http_scheme(scheme) &&
        curl_url_get(h, CURLUPART_HOST, &host, 0) == CURLUE_OK) {
        curl_url_get(h, CURLUPART_USER, &user, 0);
        curl_url_get(h, CURLUPART_PORT, &port, CURLU_NO_DEFAULT_PORT);
        curl_url_get(h, CURLUPART_PATH, &path, 0);
        curl_url_get(h, CURLUPART_QUERY, &query, 0);
        Buf b;
        buf_init(&b);
        buf_puts(&b, str_lower(scheme));
        buf_puts(&b, "://");
        if (user && *user) {
            buf_puts(&b, user);
            buf_putc(&b, '@');
        }
        buf_puts(&b, str_lower(host));
        if (port && *port) {
            buf_putc(&b, ':');
            buf_puts(&b, port);
        }
        buf_puts(&b, path && *path ? path : "/");
        if (query && *query) {
            buf_putc(&b, '?');
            buf_puts(&b, query);
        }
        result = buf_detach(&b);
    }
    curl_free(scheme);
    curl_free(host);
    curl_free(port);
    curl_free(path);
    curl_free(query);
    curl_free(user);
    curl_url_cleanup(h);
    return result;
}

/* One URL component as a malloc'd string, or NULL if absent. */
static char *url_part(const char *url, CURLUPart part, unsigned int flags)
{
    CURLU *h = curl_url();
    if (!h) return NULL;
    char *value = NULL, *result = NULL;
    if (curl_url_set(h, CURLUPART_URL, url, url_flags()) == CURLUE_OK &&
        curl_url_get(h, part, &value, flags) == CURLUE_OK) {
        result = xstrdup(value);
    }
    curl_free(value);
    curl_url_cleanup(h);
    return result;
}

/* "scheme://host[:port]" for the robots.txt cache. */
static char *origin_of(const char *url)
{
    char *scheme = url_part(url, CURLUPART_SCHEME, 0);
    char *host = url_part(url, CURLUPART_HOST, 0);
    char *port = url_part(url, CURLUPART_PORT, CURLU_NO_DEFAULT_PORT);
    char *result = NULL;
    if (scheme && host) {
        Buf b;
        buf_init(&b);
        buf_puts(&b, str_lower(scheme));
        buf_puts(&b, "://");
        buf_puts(&b, str_lower(host));
        if (port) {
            buf_putc(&b, ':');
            buf_puts(&b, port);
        }
        result = buf_detach(&b);
    }
    free(scheme);
    free(host);
    free(port);
    return result;
}

/* Path plus query, which is what robots.txt rules are matched against. */
static char *path_and_query(const char *url)
{
    char *path = url_part(url, CURLUPART_PATH, 0);
    char *query = url_part(url, CURLUPART_QUERY, 0);
    Buf b;
    buf_init(&b);
    buf_puts(&b, path && *path ? path : "/");
    if (query && *query) {
        buf_putc(&b, '?');
        buf_puts(&b, query);
    }
    free(path);
    free(query);
    return buf_detach(&b);
}

/* Host used to decide whether a link stays on the same site ("www." is ignored). */
static char *site_key(const char *url)
{
    char *host = url_part(url, CURLUPART_HOST, 0);
    if (!host) return xstrdup("");
    str_lower(host);
    if (strncmp(host, "www.", 4) == 0) {
        char *stripped = xstrdup(host + 4);
        free(host);
        return stripped;
    }
    return host;
}

/* Links ending like this are never queued while crawling: they are not pages. */
static bool looks_like_page(const char *normalized_url)
{
    static const char *const skip[] = {
        ".css", ".js", ".json", ".xml", ".rss", ".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg",
        ".webp", ".bmp", ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z", ".mp3", ".mp4", ".avi",
        ".mov", ".woff", ".woff2", ".ttf", ".eot", ".exe", ".dmg", ".doc", ".docx", ".xls",
        ".xlsx", ".ppt", ".pptx", NULL,
    };
    const char *q = strchr(normalized_url, '?');
    size_t len = q ? (size_t)(q - normalized_url) : strlen(normalized_url);
    for (int i = 0; skip[i]; i++) {
        size_t m = strlen(skip[i]);
        if (len >= m && strncasecmp(normalized_url + len - m, skip[i], m) == 0) return false;
    }
    return true;
}

/* ------------------------------------------------------------------------------------ */
/* HTML extraction (a small tolerant tokenizer; no external parser)                      */
/* ------------------------------------------------------------------------------------ */
typedef struct {
    char *name;
    char *value;
} Attr;

typedef struct {
    char name[32];
    bool closing;
    Attr attrs[MAX_ATTRS];
    int nattrs;
    size_t end; /* index just past the tag */
} Tag;

static const char *tag_attr(const Tag *t, const char *name)
{
    for (int i = 0; i < t->nattrs; i++) {
        if (strcmp(t->attrs[i].name, name) == 0) return t->attrs[i].value;
    }
    return NULL;
}

static void tag_free(Tag *t)
{
    for (int i = 0; i < t->nattrs; i++) {
        free(t->attrs[i].name);
        free(t->attrs[i].value);
    }
    t->nattrs = 0;
}

/* Parse the tag starting at s[lt] == '<'. Returns false if that '<' does not start a tag. */
static bool parse_tag(const char *s, size_t n, size_t lt, Tag *tag)
{
    size_t i = lt + 1;
    tag->closing = false;
    tag->nattrs = 0;
    if (i < n && s[i] == '/') {
        tag->closing = true;
        i++;
    }
    size_t start = i;
    while (i < n && (isalnum((unsigned char)s[i]) || s[i] == '-' || s[i] == ':' || s[i] == '_')) i++;
    if (i == start) return false;
    size_t len = i - start;
    if (len >= sizeof tag->name) len = sizeof tag->name - 1;
    memcpy(tag->name, s + start, len);
    tag->name[len] = '\0';
    str_lower(tag->name);

    while (i < n) {
        char c = s[i];
        if (c == '>') {
            i++;
            break;
        }
        if (c == '<') break; /* broken markup: let the next tag start cleanly */
        if (c == '/' || isspace((unsigned char)c)) {
            i++;
            continue;
        }
        size_t name_start = i;
        while (i < n && !isspace((unsigned char)s[i]) && s[i] != '=' && s[i] != '>' && s[i] != '<') i++;
        if (i == name_start) { /* a stray '=' */
            i++;
            continue;
        }
        char *name = str_lower(xstrndup(s + name_start, i - name_start));
        while (i < n && isspace((unsigned char)s[i])) i++;
        char *value;
        if (i < n && s[i] == '=') {
            i++;
            while (i < n && isspace((unsigned char)s[i])) i++;
            if (i < n && (s[i] == '"' || s[i] == '\'')) {
                char quote = s[i++];
                size_t value_start = i;
                while (i < n && s[i] != quote) i++;
                value = decode_entities(s + value_start, i - value_start);
                if (i < n) i++;
            } else {
                size_t value_start = i;
                while (i < n && !isspace((unsigned char)s[i]) && s[i] != '>') i++;
                value = decode_entities(s + value_start, i - value_start);
            }
        } else {
            value = xstrdup("");
        }
        if (tag->nattrs < MAX_ATTRS && !tag_attr(tag, name)) {
            tag->attrs[tag->nattrs].name = name;
            tag->attrs[tag->nattrs].value = value;
            tag->nattrs++;
        } else {
            free(name);
            free(value);
        }
    }
    tag->end = i;
    return true;
}

/* Text being gathered while walking the document. */
typedef struct {
    Buf text;    /* everything visible, for the word count */
    Buf title;
    Buf heading;
    Buf link;
    bool in_title, in_heading, in_link;
    int heading_level;
    char *link_href;
} Collector;

static void collect(Collector *c, const char *s, size_t n)
{
    buf_append(&c->text, s, n);
    if (c->in_title) buf_append(&c->title, s, n);
    if (c->in_heading) buf_append(&c->heading, s, n);
    if (c->in_link) buf_append(&c->link, s, n);
}

/* Entity-decode and whitespace-clean a gathered buffer, then reset it. */
static char *finish_text(Buf *b)
{
    char *s = decode_entities(buf_str(b), b->len);
    clean_whitespace(s);
    b->len = 0;
    if (b->data) b->data[0] = '\0';
    return s;
}

static void finish_heading(Page *page, Collector *c)
{
    char *text = finish_text(&c->heading);
    if (*text) headinglist_add(&page->headings, c->heading_level, text);
    else free(text);
    c->in_heading = false;
}

static void finish_link(Page *page, Collector *c, const char *base)
{
    char *text = finish_text(&c->link);
    char *resolved = resolve_url(base, c->link_href);
    if (resolved && !linklist_has_url(&page->links, resolved)) {
        linklist_add(&page->links, resolved, text);
    } else {
        free(resolved);
        free(text);
    }
    free(c->link_href);
    c->link_href = NULL;
    c->in_link = false;
}

static bool is_heading_tag(const char *name)
{
    return name[0] == 'h' && name[1] >= '1' && name[1] <= '3' && name[2] == '\0';
}

static bool is_raw_text_tag(const char *name)
{
    return strcmp(name, "script") == 0 || strcmp(name, "style") == 0 ||
           strcmp(name, "noscript") == 0 || strcmp(name, "template") == 0;
}

static long count_words(const char *s)
{
    long words = 0;
    bool in_word = false;
    while (*s) {
        int n = space_len(s);
        if (!n && !in_word) words++;
        in_word = !n;
        s += n ? n : 1;
    }
    return words;
}

/* Fill page from the UTF-8 HTML in html[0..n). */
static void extract(Page *page, const char *html, size_t n)
{
    Collector c;
    memset(&c, 0, sizeof c);
    char *base = xstrdup(page->final_url);
    char *meta_description = NULL, *og_description = NULL;
    bool title_done = false;
    size_t i = 0;

    while (i < n) {
        long lt = find_char(html, n, i, '<');
        if (lt < 0) {
            collect(&c, html + i, n - i);
            break;
        }
        if ((size_t)lt > i) collect(&c, html + i, (size_t)lt - i);
        i = (size_t)lt;

        if (n - i >= 4 && memcmp(html + i, "<!--", 4) == 0) {
            long end = find_str(html, n, i + 4, "-->");
            i = end < 0 ? n : (size_t)end + 3;
            continue;
        }
        if (i + 1 < n && (html[i + 1] == '!' || html[i + 1] == '?')) { /* doctype, CDATA, PI */
            long end = find_char(html, n, i, '>');
            i = end < 0 ? n : (size_t)end + 1;
            continue;
        }
        Tag tag;
        if (!parse_tag(html, n, i, &tag)) { /* a bare '<' in text, e.g. "a < b" */
            collect(&c, "<", 1);
            i++;
            continue;
        }
        i = tag.end;
        collect(&c, " ", 1); /* tags separate words */

        if (tag.closing) {
            if (strcmp(tag.name, "title") == 0 && c.in_title) {
                free(page->title);
                page->title = finish_text(&c.title);
                c.in_title = false;
            } else if (is_heading_tag(tag.name) && c.in_heading) {
                finish_heading(page, &c);
            } else if (strcmp(tag.name, "a") == 0 && c.in_link) {
                finish_link(page, &c, base);
            }
        } else if (is_raw_text_tag(tag.name)) { /* skip scripts, styles and hidden templates */
            char close[40];
            snprintf(close, sizeof close, "</%s", tag.name);
            long at = find_ci(html, n, i, close);
            if (at < 0) {
                i = n;
            } else {
                long gt = find_char(html, n, (size_t)at, '>');
                i = gt < 0 ? n : (size_t)gt + 1;
            }
        } else if (strcmp(tag.name, "title") == 0) {
            if (!title_done) {
                c.in_title = true;
                title_done = true;
            }
        } else if (is_heading_tag(tag.name)) {
            if (c.in_heading) finish_heading(page, &c); /* unterminated heading */
            c.in_heading = true;
            c.heading_level = tag.name[1] - '0';
        } else if (strcmp(tag.name, "a") == 0) {
            if (c.in_link) finish_link(page, &c, base); /* unterminated link */
            const char *href = tag_attr(&tag, "href");
            if (href) {
                c.in_link = true;
                c.link_href = xstrdup(href);
            }
        } else if (strcmp(tag.name, "img") == 0) {
            const char *src = tag_attr(&tag, "src");
            if (!src || !*src) src = tag_attr(&tag, "data-src");
            char *resolved = src ? resolve_url(base, src) : NULL; /* also drops data: URIs */
            if (resolved && !linklist_has_url(&page->images, resolved)) {
                const char *alt = tag_attr(&tag, "alt");
                char *alt_copy = xstrdup(alt ? alt : "");
                clean_whitespace(alt_copy);
                linklist_add(&page->images, resolved, alt_copy);
            } else {
                free(resolved);
            }
        } else if (strcmp(tag.name, "meta") == 0) {
            const char *name = tag_attr(&tag, "name");
            if (!name) name = tag_attr(&tag, "property");
            const char *content = tag_attr(&tag, "content");
            if (name && content) {
                char *key = str_lower(xstrdup(name));
                char *value = xstrdup(content);
                clean_whitespace(trim(key));
                clean_whitespace(value);
                if (strcmp(key, "description") == 0 && !meta_description) meta_description = value;
                else if (strcmp(key, "og:description") == 0 && !og_description) og_description = value;
                else free(value);
                free(key);
            }
        } else if (strcmp(tag.name, "base") == 0) {
            const char *href = tag_attr(&tag, "href");
            char *resolved = href ? resolve_url(page->final_url, href) : NULL;
            if (resolved) {
                free(base);
                base = resolved;
            }
        }
        tag_free(&tag);
    }

    if (c.in_title) {
        free(page->title);
        page->title = finish_text(&c.title);
    }
    if (c.in_heading) finish_heading(page, &c);
    if (c.in_link) finish_link(page, &c, base);

    free(page->description);
    page->description = meta_description ? meta_description : og_description ? og_description : xstrdup("");
    if (meta_description && og_description) free(og_description);

    char *text = decode_entities(buf_str(&c.text), c.text.len);
    page->word_count = count_words(text);
    free(text);

    buf_free(&c.text);
    buf_free(&c.title);
    buf_free(&c.heading);
    buf_free(&c.link);
    free(c.link_href);
    free(base);
}

/* ------------------------------------------------------------------------------------ */
/* robots.txt                                                                            */
/* ------------------------------------------------------------------------------------ */
typedef struct {
    char *pattern;
    bool allow;
} Rule;

typedef struct {
    char *origin;
    Rule *rules;
    size_t nrules, cap;
    double crawl_delay;
    bool disallow_all;
} Robots;

static void robots_add_rule(Robots *r, const char *pattern, bool allow)
{
    if (r->nrules == r->cap) {
        r->cap = r->cap ? r->cap * 2 : 8;
        r->rules = xrealloc(r->rules, r->cap * sizeof *r->rules);
    }
    r->rules[r->nrules].pattern = xstrdup(pattern);
    r->rules[r->nrules].allow = allow;
    r->nrules++;
}

static void robots_free(Robots *r)
{
    for (size_t i = 0; i < r->nrules; i++) free(r->rules[i].pattern);
    free(r->rules);
    free(r->origin);
    memset(r, 0, sizeof *r);
}

/* Keep the groups addressed to our User-Agent token, or the "*" groups otherwise. */
static void robots_parse(Robots *r, const char *text, const char *user_agent)
{
    char *token = xstrdup(user_agent);
    char *slash = strchr(token, '/');
    if (slash) *slash = '\0';
    str_lower(trim(token));

    for (int pass = 0; pass < 2; pass++) {
        bool want_specific = pass == 0;
        bool matched_any = false, group_active = false, in_agent_lines = false;
        char *copy = xstrdup(text);
        char *save = NULL;
        for (char *line = strtok_r(copy, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
            char *hash = strchr(line, '#');
            if (hash) *hash = '\0';
            line = trim(line);
            char *colon = strchr(line, ':');
            if (!colon) continue;
            *colon = '\0';
            char *key = str_lower(trim(line));
            char *value = trim(colon + 1);
            if (strcmp(key, "user-agent") == 0) {
                if (!in_agent_lines) {
                    group_active = false;
                    in_agent_lines = true;
                }
                str_lower(value);
                bool hit = want_specific ? (*value && strcmp(value, "*") != 0 && strstr(token, value) != NULL)
                                         : strcmp(value, "*") == 0;
                if (hit) group_active = matched_any = true;
            } else {
                in_agent_lines = false;
                if (!group_active) continue;
                if (strcmp(key, "disallow") == 0) {
                    if (*value) robots_add_rule(r, value, false);
                } else if (strcmp(key, "allow") == 0) {
                    if (*value) robots_add_rule(r, value, true);
                } else if (strcmp(key, "crawl-delay") == 0) {
                    double d = strtod(value, NULL);
                    if (d > r->crawl_delay) r->crawl_delay = d;
                }
            }
        }
        free(copy);
        if (matched_any) break; /* found groups for us; do not fall back to "*" */
    }
    free(token);
}

/* Prefix match supporting "*" wildcards; full requires the whole path to match ("$"). */
static bool glob_match(const char *p, const char *s, bool full)
{
    while (*p) {
        if (*p == '*') {
            while (*p == '*') p++;
            if (!*p) return true;
            for (const char *t = s;; t++) {
                if (glob_match(p, t, full)) return true;
                if (!*t) break;
            }
            return false;
        }
        if (*s != *p) return false; /* also fails at the end of s */
        p++;
        s++;
    }
    return !full || *s == '\0';
}

/* Longest matching rule wins; Allow wins a tie (as in RFC 9309). */
static bool robots_allows(const Robots *r, const char *path)
{
    if (r->disallow_all) return false;
    long best = -1;
    bool allowed = true;
    for (size_t i = 0; i < r->nrules; i++) {
        const char *pattern = r->rules[i].pattern;
        size_t len = strlen(pattern);
        bool anchored = len > 0 && pattern[len - 1] == '$';
        char *p = xstrndup(pattern, anchored ? len - 1 : len);
        bool hit = glob_match(p, path, anchored);
        free(p);
        if (!hit) continue;
        if ((long)len > best || ((long)len == best && r->rules[i].allow)) {
            best = (long)len;
            allowed = r->rules[i].allow;
        }
    }
    return allowed;
}

/* ------------------------------------------------------------------------------------ */
/* HTTP                                                                                  */
/* ------------------------------------------------------------------------------------ */
typedef struct {
    int depth, max_pages, retries;
    double delay, timeout;
    long max_bytes;
    const char *output;
    const char *user_agent;
    bool allow_external, ignore_robots;
    StrList urls;
} Options;

typedef struct {
    long status;
    char *final_url;
    char *content_type;
    Buf body;
    long max_bytes;
    bool truncated;
    double retry_after;
    char errbuf[CURL_ERROR_SIZE];
} Response;

static void response_free(Response *r)
{
    free(r->final_url);
    free(r->content_type);
    buf_free(&r->body);
    r->final_url = r->content_type = NULL;
}

static size_t on_body(char *ptr, size_t size, size_t nmemb, void *userdata)
{
    Response *r = userdata;
    size_t n = size * nmemb;
    size_t room = (size_t)r->max_bytes - r->body.len;
    if (n > room) {
        buf_append(&r->body, ptr, room);
        r->truncated = true;
        return 0; /* tells libcurl to stop the transfer; we keep what we have */
    }
    buf_append(&r->body, ptr, n);
    return n;
}

static size_t on_header(char *buffer, size_t size, size_t nitems, void *userdata)
{
    Response *r = userdata;
    size_t n = size * nitems;
    static const char prefix[] = "retry-after:";
    size_t plen = sizeof prefix - 1;
    if (n > plen && strncasecmp(buffer, prefix, plen) == 0) {
        char tmp[64];
        size_t len = n - plen < sizeof tmp - 1 ? n - plen : sizeof tmp - 1;
        memcpy(tmp, buffer + plen, len);
        tmp[len] = '\0';
        char *end;
        double v = strtod(tmp, &end);
        if (end != tmp && v > 0) r->retry_after = v < MAX_RETRY_WAIT ? v : MAX_RETRY_WAIT;
    }
    return n;
}

typedef struct {
    const Options *opt;
    CURL *curl;
    struct curl_slist *headers;
    Robots *robots; /* cache, one entry per origin */
    size_t nrobots;
    double next_request_at;
} Scraper;

/* One GET, following redirects. On CURLE_OK the response is filled in. */
static CURLcode http_get(Scraper *sc, const char *url, Response *r)
{
    CURL *c = sc->curl;
    memset(r, 0, sizeof *r);
    buf_init(&r->body);
    r->max_bytes = sc->opt->max_bytes;

    curl_easy_reset(c);
    curl_easy_setopt(c, CURLOPT_URL, url);
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(c, CURLOPT_MAXREDIRS, 10L);
    curl_easy_setopt(c, CURLOPT_USERAGENT, sc->opt->user_agent);
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, sc->headers);
    curl_easy_setopt(c, CURLOPT_ACCEPT_ENCODING, "");
    curl_easy_setopt(c, CURLOPT_TIMEOUT_MS, (long)(sc->opt->timeout * 1000));
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT_MS, (long)(sc->opt->timeout * 1000));
    curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, on_body);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, r);
    curl_easy_setopt(c, CURLOPT_HEADERFUNCTION, on_header);
    curl_easy_setopt(c, CURLOPT_HEADERDATA, r);
    curl_easy_setopt(c, CURLOPT_ERRORBUFFER, r->errbuf);
#if CURL_AT_LEAST_VERSION(7, 85, 0)
    curl_easy_setopt(c, CURLOPT_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(c, CURLOPT_REDIR_PROTOCOLS_STR, "http,https");
#else
    curl_easy_setopt(c, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
    curl_easy_setopt(c, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
#endif

    CURLcode rc = curl_easy_perform(c);
    if (rc == CURLE_WRITE_ERROR && r->truncated) rc = CURLE_OK;
    if (rc == CURLE_OK) {
        char *s = NULL;
        curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &r->status);
        if (curl_easy_getinfo(c, CURLINFO_EFFECTIVE_URL, &s) != CURLE_OK || !s) s = (char *)url;
        r->final_url = xstrdup(s);
        s = NULL;
        if (curl_easy_getinfo(c, CURLINFO_CONTENT_TYPE, &s) != CURLE_OK || !s) s = "";
        r->content_type = xstrdup(s);
    }
    return rc;
}

static void wait_turn(Scraper *sc, double delay)
{
    double now = monotonic_seconds();
    if (now < sc->next_request_at) sleep_seconds(sc->next_request_at - now);
    sc->next_request_at = monotonic_seconds() + delay;
}

static double backoff_seconds(int attempt)
{
    double wait = 1.0;
    for (int i = 0; i < attempt; i++) wait *= 2; /* 2s, 4s, 8s ... */
    return wait < MAX_RETRY_WAIT ? wait : MAX_RETRY_WAIT;
}

static bool is_retry_status(long status)
{
    return status == 429 || status == 500 || status == 502 || status == 503 || status == 504;
}

/* GET with pacing and retries. Returns CURLE_OK once a response (any status) is in hand;
 * otherwise the last error, with a message in r->errbuf. The caller frees r either way. */
static CURLcode fetch(Scraper *sc, const char *url, double delay, Response *r)
{
    for (int attempt = 1;; attempt++) {
        wait_turn(sc, delay);
        CURLcode rc = http_get(sc, url, r);
        if (rc != CURLE_OK) {
            if (!r->errbuf[0]) snprintf(r->errbuf, sizeof r->errbuf, "%s", curl_easy_strerror(rc));
            if (attempt > sc->opt->retries) return rc;
            double wait = backoff_seconds(attempt);
            warning("%s -> %s; retry %d/%d in %.0fs", url, r->errbuf, attempt, sc->opt->retries, wait);
            response_free(r);
            sleep_seconds(wait);
            continue;
        }
        if (is_retry_status(r->status) && attempt <= sc->opt->retries) {
            double wait = r->retry_after > 0 ? r->retry_after : backoff_seconds(attempt);
            warning("%s -> HTTP %ld; retry %d/%d in %.0fs", url, r->status, attempt, sc->opt->retries, wait);
            response_free(r);
            sleep_seconds(wait);
            continue;
        }
        return CURLE_OK;
    }
}

/* The robots.txt rules for the URL's origin, fetched once and cached. NULL = no restrictions. */
static Robots *robots_for(Scraper *sc, const char *url)
{
    char *origin = origin_of(url);
    if (!origin) return NULL;
    for (size_t i = 0; i < sc->nrobots; i++) {
        if (strcmp(sc->robots[i].origin, origin) == 0) {
            free(origin);
            return &sc->robots[i];
        }
    }

    sc->robots = xrealloc(sc->robots, (sc->nrobots + 1) * sizeof *sc->robots);
    Robots *r = &sc->robots[sc->nrobots++];
    memset(r, 0, sizeof *r);
    r->origin = origin;

    Buf url_buf;
    buf_init(&url_buf);
    buf_puts(&url_buf, origin);
    buf_puts(&url_buf, "/robots.txt");
    Response resp;
    CURLcode rc = fetch(sc, buf_str(&url_buf), sc->opt->delay, &resp);
    if (rc != CURLE_OK) {
        warning("could not read %s (%s); assuming no restrictions", buf_str(&url_buf), resp.errbuf);
    } else if (resp.status >= 500) {
        warning("%s answered HTTP %ld; treating the site as off limits", buf_str(&url_buf), resp.status);
        r->disallow_all = true;
    } else if (resp.status < 400) {
        robots_parse(r, buf_str(&resp.body), sc->opt->user_agent);
    }
    response_free(&resp);
    buf_free(&url_buf);
    return r;
}

static char *media_type(const char *content_type)
{
    char *copy = xstrdup(content_type);
    char *semicolon = strchr(copy, ';');
    if (semicolon) *semicolon = '\0';
    char *t = str_lower(trim(copy));
    char *result = xstrdup(t);
    free(copy);
    return result;
}

static bool is_html_type(const char *media)
{
    return strcmp(media, "text/html") == 0 || strcmp(media, "application/xhtml+xml") == 0;
}

/* Fetch one URL and fill the page; never fails outright (see page->error). */
static void scrape(Scraper *sc, Page *page)
{
    now_iso8601(page->fetched_at);

    double delay = sc->opt->delay;
    if (!sc->opt->ignore_robots) {
        Robots *robots = robots_for(sc, page->url);
        if (robots) {
            char *path = path_and_query(page->url);
            bool allowed = robots_allows(robots, path);
            free(path);
            if (!allowed) {
                page_set_error(page, "disallowed by robots.txt");
                return;
            }
            if (robots->crawl_delay > delay) delay = robots->crawl_delay;
        }
    }

    Response r;
    CURLcode rc = fetch(sc, page->url, delay, &r);
    if (rc != CURLE_OK) {
        page_set_error(page, "request failed: %s", r.errbuf);
        response_free(&r);
        return;
    }
    free(page->final_url);
    page->final_url = xstrdup(r.final_url);
    page->status = r.status;
    free(page->content_type);
    page->content_type = media_type(r.content_type);
    if (r.status >= 400) {
        page_set_error(page, "HTTP %ld", r.status);
    } else if (*page->content_type && !is_html_type(page->content_type)) {
        page_set_error(page, "not HTML (%s)", page->content_type);
    } else {
        if (r.truncated) warning("%s: body larger than %ld bytes, truncated", page->url, sc->opt->max_bytes);
        char *charset = detect_charset(r.content_type, buf_str(&r.body), r.body.len);
        size_t html_len = 0;
        char *html = to_utf8(buf_str(&r.body), r.body.len, charset, &html_len);
        extract(page, html, html_len);
        free(html);
        free(charset);
    }
    response_free(&r);
}

/* ------------------------------------------------------------------------------------ */
/* JSON output                                                                           */
/* ------------------------------------------------------------------------------------ */
static void json_string(FILE *out, const char *s)
{
    fputc('"', out);
    const unsigned char *p = (const unsigned char *)s;
    while (*p) {
        unsigned char c = *p;
        if (c == '"') {
            fputs("\\\"", out);
        } else if (c == '\\') {
            fputs("\\\\", out);
        } else if (c == '\n') {
            fputs("\\n", out);
        } else if (c == '\r') {
            fputs("\\r", out);
        } else if (c == '\t') {
            fputs("\\t", out);
        } else if (c < 0x20) {
            fprintf(out, "\\u%04x", c);
        } else if (c < 0x80) {
            fputc(c, out);
        } else {
            int len = utf8_sequence_length(p);
            if (len == 0) {
                fputs("\xEF\xBF\xBD", out); /* U+FFFD for bytes that are not valid UTF-8 */
            } else {
                fwrite(p, 1, (size_t)len, out);
                p += len;
                continue;
            }
        }
        p++;
    }
    fputc('"', out);
}

static void json_field(FILE *out, const char *name, const char *value, bool last)
{
    fprintf(out, "    \"%s\": ", name);
    json_string(out, value);
    fputs(last ? "\n" : ",\n", out);
}

static void json_link_list(FILE *out, const char *name, const LinkList *l, const char *text_key)
{
    fprintf(out, "    \"%s\": [", name);
    for (size_t i = 0; i < l->len; i++) {
        fputs(i ? ",\n      {\"url\": " : "\n      {\"url\": ", out);
        json_string(out, l->items[i].url);
        fprintf(out, ", \"%s\": ", text_key);
        json_string(out, l->items[i].text);
        fputc('}', out);
    }
    fputs(l->len ? "\n    ],\n" : "],\n", out);
}

static void json_page(FILE *out, const Page *p)
{
    fputs("  {\n", out);
    json_field(out, "url", p->url, false);
    fprintf(out, "    \"depth\": %d,\n", p->depth);
    json_field(out, "final_url", p->final_url, false);
    if (p->status) fprintf(out, "    \"status\": %ld,\n", p->status);
    else fputs("    \"status\": null,\n", out);
    json_field(out, "content_type", p->content_type, false);
    json_field(out, "fetched_at", p->fetched_at, false);
    json_field(out, "title", p->title, false);
    json_field(out, "description", p->description, false);
    fputs("    \"headings\": [", out);
    for (size_t i = 0; i < p->headings.len; i++) {
        fprintf(out, "%s\n      {\"level\": %d, \"text\": ", i ? "," : "", p->headings.items[i].level);
        json_string(out, p->headings.items[i].text);
        fputc('}', out);
    }
    fputs(p->headings.len ? "\n    ],\n" : "],\n", out);
    json_link_list(out, "links", &p->links, "text");
    json_link_list(out, "images", &p->images, "alt");
    fprintf(out, "    \"word_count\": %ld,\n", p->word_count);
    if (p->error) json_field(out, "error", p->error, true);
    else fputs("    \"error\": null\n", out);
    fputs("  }", out);
}

/* ------------------------------------------------------------------------------------ */
/* Command line and main loop                                                            */
/* ------------------------------------------------------------------------------------ */
static void usage(FILE *out)
{
    fputs("usage: webscraper [options] URL [URL ...]\n"
          "\n"
          "Scrape one or more web pages (title, description, headings, links, images,\n"
          "word count) and optionally crawl a site. Results are printed as JSON.\n"
          "\n"
          "options:\n"
          "  -o, --output FILE        write JSON to FILE instead of stdout\n"
          "  -d, --depth N            follow links N levels deep (default 0: only the given URLs)\n"
          "  -m, --max-pages N        stop after fetching N pages (default 50)\n"
          "      --delay SECONDS      minimum pause between requests (default 1)\n"
          "      --timeout SECONDS    per-request timeout (default 15)\n"
          "      --retries N          retries for network errors and HTTP 429/5xx (default 2)\n"
          "      --max-bytes N        read at most N bytes per page (default 5000000)\n"
          "      --user-agent STRING  User-Agent header to send\n"
          "      --allow-external     when crawling, also follow links to other sites\n"
          "      --ignore-robots      do not consult robots.txt (only for sites you own)\n"
          "  -q, --quiet              only report errors\n"
          "  -h, --help               show this help\n"
          "\n"
          "examples:\n"
          "  webscraper https://example.com\n"
          "  webscraper https://example.com --depth 1 --max-pages 25 -o site.json\n",
          out);
}

static const char *need_value(int argc, char **argv, int *i, const char *option)
{
    if (*i + 1 >= argc) die("%s requires a value", option);
    return argv[++*i];
}

static long parse_long(const char *option, const char *value)
{
    char *end;
    errno = 0;
    long v = strtol(value, &end, 10);
    if (errno || end == value || *end) die("%s expects an integer, got '%s'", option, value);
    return v;
}

static double parse_double(const char *option, const char *value)
{
    char *end;
    errno = 0;
    double v = strtod(value, &end);
    if (errno || end == value || *end) die("%s expects a number, got '%s'", option, value);
    return v;
}

static void parse_options(int argc, char **argv, Options *opt)
{
    memset(opt, 0, sizeof *opt);
    opt->max_pages = 50;
    opt->retries = 2;
    opt->delay = 1.0;
    opt->timeout = 15.0;
    opt->max_bytes = 5000000;
    opt->user_agent = DEFAULT_USER_AGENT;

    for (int i = 1; i < argc; i++) {
        const char *a = argv[i];
        if (strcmp(a, "-h") == 0 || strcmp(a, "--help") == 0) {
            usage(stdout);
            exit(0);
        } else if (strcmp(a, "-q") == 0 || strcmp(a, "--quiet") == 0) {
            g_quiet = true;
        } else if (strcmp(a, "--allow-external") == 0) {
            opt->allow_external = true;
        } else if (strcmp(a, "--ignore-robots") == 0) {
            opt->ignore_robots = true;
        } else if (strcmp(a, "-o") == 0 || strcmp(a, "--output") == 0) {
            opt->output = need_value(argc, argv, &i, a);
        } else if (strcmp(a, "-d") == 0 || strcmp(a, "--depth") == 0) {
            opt->depth = (int)parse_long(a, need_value(argc, argv, &i, a));
        } else if (strcmp(a, "-m") == 0 || strcmp(a, "--max-pages") == 0) {
            opt->max_pages = (int)parse_long(a, need_value(argc, argv, &i, a));
        } else if (strcmp(a, "--retries") == 0) {
            opt->retries = (int)parse_long(a, need_value(argc, argv, &i, a));
        } else if (strcmp(a, "--max-bytes") == 0) {
            opt->max_bytes = parse_long(a, need_value(argc, argv, &i, a));
        } else if (strcmp(a, "--delay") == 0) {
            opt->delay = parse_double(a, need_value(argc, argv, &i, a));
        } else if (strcmp(a, "--timeout") == 0) {
            opt->timeout = parse_double(a, need_value(argc, argv, &i, a));
        } else if (strcmp(a, "--user-agent") == 0) {
            opt->user_agent = need_value(argc, argv, &i, a);
        } else if (a[0] == '-' && a[1]) {
            die("unknown option: %s", a);
        } else {
            char *url;
            if (strstr(a, "://")) {
                url = xstrdup(a);
            } else {
                url = xmalloc(strlen(a) + 9);
                strcpy(url, "https://");
                strcat(url, a);
            }
            char *normalized = normalize_url(url);
            if (!normalized) die("not an http(s) URL: %s", a);
            free(url);
            strlist_push(&opt->urls, normalized);
        }
    }
    if (opt->urls.len == 0) die("at least one URL is required");
    if (opt->depth < 0 || opt->max_pages < 1 || opt->delay < 0 || opt->retries < 0 || opt->timeout <= 0) {
        die("--depth, --delay and --retries must be >= 0, --max-pages >= 1, --timeout > 0");
    }
    if (opt->max_bytes < 1024) die("--max-bytes must be at least 1024");
}

typedef struct {
    const char *url; /* borrowed from the "seen" list */
    int depth;
} QueueItem;

typedef struct {
    QueueItem *items;
    size_t head, len, cap;
} Queue;

static void queue_push(Queue *q, const char *url, int depth)
{
    if (q->len == q->cap) {
        q->cap = q->cap ? q->cap * 2 : 64;
        q->items = xrealloc(q->items, q->cap * sizeof *q->items);
    }
    q->items[q->len].url = url;
    q->items[q->len].depth = depth;
    q->len++;
}

int main(int argc, char **argv)
{
    Options opt;
    parse_options(argc, argv, &opt);

    if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) {
        fputs("error: could not initialise libcurl\n", stderr);
        return 1;
    }
    Scraper sc;
    memset(&sc, 0, sizeof sc);
    sc.opt = &opt;
    sc.curl = curl_easy_init();
    if (!sc.curl) {
        fputs("error: could not create a libcurl handle\n", stderr);
        return 1;
    }
    sc.headers = curl_slist_append(NULL, "Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
    sc.headers = curl_slist_append(sc.headers, "Accept-Language: en");

    /* Breadth-first crawl state: "seen" owns every URL string, the queue borrows them. */
    StrList seen, sites;
    memset(&seen, 0, sizeof seen);
    memset(&sites, 0, sizeof sites);
    Queue queue;
    memset(&queue, 0, sizeof queue);
    for (size_t i = 0; i < opt.urls.len; i++) {
        const char *url = opt.urls.items[i];
        if (strlist_contains(&seen, url)) continue;
        char *copy = xstrdup(url);
        strlist_push(&seen, copy);
        queue_push(&queue, copy, 0);
        char *key = site_key(url);
        if (strlist_contains(&sites, key)) free(key);
        else strlist_push(&sites, key);
    }

    FILE *out = stdout;
    if (opt.output) {
        out = fopen(opt.output, "w");
        if (!out) die("cannot open %s: %s", opt.output, strerror(errno));
    }
    fputs("[", out);

    size_t fetched = 0, failed = 0;
    while (queue.head < queue.len && fetched < (size_t)opt.max_pages) {
        QueueItem item = queue.items[queue.head++];
        Page page;
        page_init(&page, item.url, item.depth);
        scrape(&sc, &page);
        fetched++;
        if (page.error) failed++;

        fputs(fetched > 1 ? ",\n" : "\n", out);
        json_page(out, &page);
        fflush(out);
        if (page.error) {
            info("[%zu/%d] %s -> %s", fetched, opt.max_pages, page.url, page.error);
        } else {
            info("[%zu/%d] %s -> HTTP %ld, %zu links, %zu images, %ld words", fetched, opt.max_pages,
                 page.url, page.status, page.links.len, page.images.len, page.word_count);
        }

        if (item.depth < opt.depth && !page.error) {
            char *final_normalized = normalize_url(page.final_url);
            if (final_normalized && !strlist_contains(&seen, final_normalized)) strlist_push(&seen, final_normalized);
            else free(final_normalized);
            for (size_t i = 0; i < page.links.len; i++) {
                char *target = normalize_url(page.links.items[i].url);
                if (!target) continue;
                bool keep = !strlist_contains(&seen, target) && looks_like_page(target);
                if (keep && !opt.allow_external) {
                    char *key = site_key(target);
                    keep = strlist_contains(&sites, key);
                    free(key);
                }
                if (!keep) {
                    free(target);
                    continue;
                }
                strlist_push(&seen, target);
                queue_push(&queue, target, item.depth + 1);
            }
        }
        page_free(&page);
    }
    fputs(fetched ? "\n]\n" : "]\n", out);
    if (queue.head < queue.len) {
        info("stopped at --max-pages %d with %zu URLs still queued", opt.max_pages, queue.len - queue.head);
    }
    info("done: %zu pages, %zu failed%s%s", fetched, failed, opt.output ? ", written to " : "",
         opt.output ? opt.output : "");

    if (out != stdout && fclose(out) != 0) {
        fprintf(stderr, "error: writing %s: %s\n", opt.output, strerror(errno));
        return 1;
    }
    for (size_t i = 0; i < sc.nrobots; i++) robots_free(&sc.robots[i]);
    free(sc.robots);
    curl_slist_free_all(sc.headers);
    curl_easy_cleanup(sc.curl);
    curl_global_cleanup();
    free(queue.items);
    strlist_free(&seen);
    strlist_free(&sites);
    strlist_free(&opt.urls);
    return fetched > 0 && failed == fetched ? 1 : 0;
}
