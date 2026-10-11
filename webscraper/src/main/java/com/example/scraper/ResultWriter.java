package com.example.scraper;

import java.io.IOException;
import java.io.Writer;
import java.util.List;

/** Serializes scrape results as JSON or CSV without extra dependencies. */
public final class ResultWriter {

    private ResultWriter() {}

    public static void writeJson(List<PageData> pages, Writer out) throws IOException {
        out.write("[\n");
        for (int i = 0; i < pages.size(); i++) {
            PageData p = pages.get(i);
            out.write("  {\n");
            out.write("    \"url\": " + str(p.url()) + ",\n");
            out.write("    \"statusCode\": " + p.statusCode() + ",\n");
            out.write("    \"depth\": " + p.depth() + ",\n");
            out.write("    \"title\": " + str(p.title()) + ",\n");
            out.write("    \"description\": " + str(p.description()) + ",\n");
            out.write("    \"headings\": " + array(p.headings()) + ",\n");
            out.write("    \"links\": " + array(p.links()) + ",\n");
            out.write("    \"images\": " + array(p.images()) + ",\n");
            out.write("    \"selected\": " + array(p.selected()) + ",\n");
            out.write("    \"error\": " + (p.error() == null ? "null" : str(p.error())) + "\n");
            out.write(i < pages.size() - 1 ? "  },\n" : "  }\n");
        }
        out.write("]\n");
        out.flush();
    }

    public static void writeCsv(List<PageData> pages, Writer out) throws IOException {
        out.write("url,statusCode,depth,title,description,headingCount,linkCount,imageCount,selected,error\n");
        for (PageData p : pages) {
            out.write(String.join(",",
                    csv(p.url()),
                    String.valueOf(p.statusCode()),
                    String.valueOf(p.depth()),
                    csv(p.title()),
                    csv(p.description()),
                    String.valueOf(p.headings().size()),
                    String.valueOf(p.links().size()),
                    String.valueOf(p.images().size()),
                    csv(String.join(" | ", p.selected())),
                    csv(p.error() == null ? "" : p.error())));
            out.write("\n");
        }
        out.flush();
    }

    static String str(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        return sb.append('"').toString();
    }

    private static String array(List<String> items) {
        if (items.isEmpty()) return "[]";
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(str(items.get(i)));
        }
        return sb.append(']').toString();
    }

    static String csv(String s) {
        if (s == null) return "";
        if (s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r")) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }
}
