package com.example.scraper;

import java.util.List;

/**
 * Everything extracted from a single scraped page.
 *
 * @param url        the page URL
 * @param statusCode HTTP status code (or -1 if the request failed)
 * @param depth      crawl depth at which the page was found (0 = start URL)
 * @param title      contents of the &lt;title&gt; tag
 * @param description contents of the meta description tag, if any
 * @param headings   text of all h1-h3 elements
 * @param links      absolute URLs of all links on the page
 * @param images     absolute URLs of all images on the page
 * @param selected   text of elements matching the user-supplied CSS selector
 * @param error      error message if fetching/parsing failed, otherwise null
 */
public record PageData(
        String url,
        int statusCode,
        int depth,
        String title,
        String description,
        List<String> headings,
        List<String> links,
        List<String> images,
        List<String> selected,
        String error) {

    static PageData failed(String url, int depth, int statusCode, String error) {
        return new PageData(url, statusCode, depth, "", "", List.of(), List.of(), List.of(), List.of(), error);
    }
}
