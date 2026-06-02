import { SITE_URL } from "@/utils/constants";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: "/api/",
      },

      // SEO crawlers
      { userAgent: "AhrefsBot", disallow: "/" },
      { userAgent: "SemrushBot", disallow: "/" },
      { userAgent: "SemrushBot-SA", disallow: "/" },
      { userAgent: "MJ12bot", disallow: "/" },
      { userAgent: "DotBot", disallow: "/" },
      { userAgent: "BLEXBot", disallow: "/" },
      { userAgent: "Barkrowler", disallow: "/" },
      { userAgent: "DataForSeoBot", disallow: "/" },
      { userAgent: "SEOkicks", disallow: "/" },
      { userAgent: "serpstatbot", disallow: "/" },
      { userAgent: "MegaIndex", disallow: "/" },

      // Other large crawlers
      { userAgent: "Bytespider", disallow: "/" },
      { userAgent: "PetalBot", disallow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
