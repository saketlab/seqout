import Wrapper from "@/components/wrapper";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import "@radix-ui/themes/styles.css";
import type { Metadata } from "next";
import Script from "next/script";

const GA_TRACKING_ID = "G-XF18RH7984";

export const viewport = {
  themeColor: "#0e1015",
};

export const metadata: Metadata = {
  title: {
    default: "seqout - Search GEO, SRA, ENA & ArrayExpress Datasets",
    template: "%s | seqout",
  },
  description:
    "Fast exploration of GEO, SRA, ENA & ArrayExpress sequencing datasets. Search millions of experiments with unified metadata views, relevance-ranked results, and consolidated sample tables. Developed at Saket Lab, IIT Bombay.",
  applicationName: "seqout",
  keywords: [
    "seqout",
    "pysradb",
    "pysraweb",
    "SRA metadata search",
    "GEO metadata search",
    "ENA metadata search",
    "ArrayExpress metadata search",
    "SRA bulk metadata",
    "GEO bulk metadata",
    "ENA bulk metadata",
    "ArrayExpress bulk metadata",
    "sequencing metadata discovery",
    "harmonized metadata SRA",
    "harmonized metadata GEO",
    "harmonized metadata ENA",
    "harmonized metadata ArrayExpress",
    "SRA metadata",
    "GEO metadata",
    "ENA metadata",
    "ArrayExpress metadata",
    "sequencing data discovery",
    "metadata search sequencing",
    "SRA",
    "GEO",
    "ENA",
    "ArrayExpress",
    "Sequence Read Archive",
    "Gene Expression Omnibus",
    "European Nucleotide Archive",
    "NCBI",
    "EBI",
    "RNA-seq",
    "ChIP-seq",
    "ATAC-seq",
    "scRNA-seq",
    "single-cell",
    "bioinformatics",
    "public datasets",
    "next-generation sequencing",
    "NGS",
    "FASTQ",
    "experiment metadata",
    "sample metadata",
    "genomics",
    "transcriptomics",
  ],
  authors: [{ name: "Saket Lab", url: "https://saketlab.org" }],
  creator: "Saket Lab, IIT Bombay",
  publisher: "Saket Lab",
  metadataBase: new URL("https://seqout.org"),
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://seqout.org",
    siteName: "seqout",
    title: "seqout - Search GEO, SRA, ENA & ArrayExpress Datasets",
    description:
      "Fast exploration of GEO, SRA, ENA & ArrayExpress sequencing datasets. Search millions of experiments with unified metadata views and relevance-ranked results.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "seqout - GEO, SRA, ENA & ArrayExpress Dataset Search",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "seqout - Search GEO, SRA, ENA & ArrayExpress",
    description:
      "Fast exploration of GEO, SRA, ENA & ArrayExpress sequencing datasets. Search millions of experiments with unified metadata views.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "seqout",
              url: "https://seqout.org",
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate:
                    "https://seqout.org/search?q={search_term_string}",
                },
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        <style dangerouslySetInnerHTML={{ __html: `
          .logo-light { display: block; }
          .logo-dark { display: none; }
          .dark .logo-light { display: none; }
          .dark .logo-dark { display: block; }
        `}} />
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_TRACKING_ID}');
          `}
        </Script>
      </head>
      <body>
        <Wrapper>{children}</Wrapper>
      </body>
    </html>
  );
}
