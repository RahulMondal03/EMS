package com.example.scraper;

import java.time.Duration;

/**
 * Crawl settings. Use {@link #builder()} to create one.
 */
public record ScraperConfig(
        int maxDepth,
        int maxPages,
        boolean sameDomainOnly,
        boolean respectRobotsTxt,
        Duration delay,
        Duration timeout,
        String userAgent,
        String cssSelector) {

    public static final String DEFAULT_USER_AGENT = "JavaWebScraper/1.0 (+https://github.com/rahulmondal03/ems)";

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private int maxDepth = 1;
        private int maxPages = 50;
        private boolean sameDomainOnly = true;
        private boolean respectRobotsTxt = true;
        private Duration delay = Duration.ofMillis(500);
        private Duration timeout = Duration.ofSeconds(10);
        private String userAgent = DEFAULT_USER_AGENT;
        private String cssSelector = null;

        public Builder maxDepth(int v) { this.maxDepth = v; return this; }
        public Builder maxPages(int v) { this.maxPages = v; return this; }
        public Builder sameDomainOnly(boolean v) { this.sameDomainOnly = v; return this; }
        public Builder respectRobotsTxt(boolean v) { this.respectRobotsTxt = v; return this; }
        public Builder delay(Duration v) { this.delay = v; return this; }
        public Builder timeout(Duration v) { this.timeout = v; return this; }
        public Builder userAgent(String v) { this.userAgent = v; return this; }
        public Builder cssSelector(String v) { this.cssSelector = v; return this; }

        public ScraperConfig build() {
            if (maxDepth < 0) throw new IllegalArgumentException("maxDepth must be >= 0");
            if (maxPages < 1) throw new IllegalArgumentException("maxPages must be >= 1");
            return new ScraperConfig(maxDepth, maxPages, sameDomainOnly, respectRobotsTxt,
                    delay, timeout, userAgent, cssSelector);
        }
    }
}
