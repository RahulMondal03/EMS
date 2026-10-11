package com.example.scraper;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Minimal robots.txt parser. Honours the Allow/Disallow rules in the group for
 * our user agent (or "*"), using longest-match-wins semantics.
 */
public final class RobotsTxt {

    private record Rule(String prefix, boolean allow) {}

    private final List<Rule> rules;

    private RobotsTxt(List<Rule> rules) {
        this.rules = rules;
    }

    public static RobotsTxt allowAll() {
        return new RobotsTxt(List.of());
    }

    public static RobotsTxt parse(String content, String userAgent) {
        String agentToken = userAgent.split("[/ ]")[0].toLowerCase(Locale.ROOT);
        List<Rule> specific = new ArrayList<>();
        List<Rule> wildcard = new ArrayList<>();

        List<String> currentAgents = new ArrayList<>();
        boolean lastWasAgent = false;

        for (String rawLine : content.split("\\R")) {
            String line = rawLine.replaceFirst("#.*", "").trim();
            int colon = line.indexOf(':');
            if (colon < 0) continue;
            String key = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(colon + 1).trim();

            if (key.equals("user-agent")) {
                if (!lastWasAgent) currentAgents.clear();
                currentAgents.add(value.toLowerCase(Locale.ROOT));
                lastWasAgent = true;
                continue;
            }
            lastWasAgent = false;
            if (!key.equals("allow") && !key.equals("disallow")) continue;
            if (key.equals("disallow") && value.isEmpty()) continue; // empty Disallow = allow everything

            Rule rule = new Rule(value, key.equals("allow"));
            for (String agent : currentAgents) {
                if (agent.equals("*")) wildcard.add(rule);
                else if (agentToken.contains(agent) || agent.contains(agentToken)) specific.add(rule);
            }
        }
        return new RobotsTxt(specific.isEmpty() ? wildcard : specific);
    }

    /** @param path URL path (plus query), e.g. "/private/page?x=1" */
    public boolean isAllowed(String path) {
        if (path == null || path.isEmpty()) path = "/";
        Rule best = null;
        for (Rule rule : rules) {
            if (matches(rule.prefix(), path)
                    && (best == null || rule.prefix().length() > best.prefix().length()
                        || (rule.prefix().length() == best.prefix().length() && rule.allow()))) {
                best = rule;
            }
        }
        return best == null || best.allow();
    }

    /** Supports '*' wildcards and a trailing '$' anchor. */
    private static boolean matches(String pattern, String path) {
        boolean anchored = pattern.endsWith("$");
        if (anchored) pattern = pattern.substring(0, pattern.length() - 1);
        StringBuilder regex = new StringBuilder();
        for (String part : pattern.split("\\*", -1)) {
            if (regex.length() > 0) regex.append(".*");
            regex.append(java.util.regex.Pattern.quote(part));
        }
        if (!anchored) regex.append(".*");
        return path.matches(regex.toString());
    }
}
