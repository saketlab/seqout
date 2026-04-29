import FooterGate from "@/components/footer-gate";
import Wrapper from "@/components/wrapper";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import "@radix-ui/themes/styles.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
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
    <html
      suppressHydrationWarning
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      data-gramm="false"
      data-gramm_editor="false"
      data-enable-grammarly="false"
    >
      <head>
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
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
          .logo-light { display: none; }
          .logo-dark { display: block; }
          .light .logo-light { display: block; }
          .light .logo-dark { display: none; }

          :root,
          .radix-themes {
            --default-font-family:
              var(--font-geist-sans),
              ui-sans-serif, system-ui, -apple-system, "Segoe UI",
              Helvetica, Arial, sans-serif;
            --heading-font-family:
              var(--font-geist-sans),
              ui-sans-serif, system-ui, -apple-system, "Segoe UI",
              Helvetica, Arial, sans-serif;
            --strong-font-family:
              var(--font-geist-sans),
              ui-sans-serif, system-ui, -apple-system, sans-serif;
            --em-font-family:
              var(--font-geist-sans),
              ui-sans-serif, system-ui, -apple-system, sans-serif;
            --quote-font-family:
              var(--font-geist-sans),
              ui-sans-serif, system-ui, -apple-system, sans-serif;
            --code-font-family:
              var(--font-geist-mono),
              ui-monospace, "SF Mono", "Cascadia Code", "Source Code Pro",
              Menlo, Consolas, monospace;
            --default-mono-font-family:
              var(--font-geist-mono),
              ui-monospace, "SF Mono", "Cascadia Code", "Source Code Pro",
              Menlo, Consolas, monospace;
          }

          .rt-Heading {
            letter-spacing: -0.015em;
          }
          .rt-Heading[data-size="6"],
          .rt-Heading[data-size="7"],
          .rt-Heading[data-size="8"],
          .rt-Heading[data-size="9"] {
            letter-spacing: -0.022em;
          }

          .rt-Text[data-size="6"][data-weight="bold"],
          .rt-Text[data-size="7"][data-weight="bold"],
          .rt-Text[data-size="8"][data-weight="bold"],
          .rt-Text[data-size="9"][data-weight="bold"] {
            letter-spacing: -0.022em;
          }

          .rt-Badge,
          .rt-TableCell,
          .ag-cell {
            font-variant-numeric: tabular-nums;
            font-feature-settings: "tnum" 1, "cv11" 1;
          }

          .seqout-accession {
            font-family: var(--code-font-family);
            font-feature-settings: "ss01" 1, "ss03" 1, "tnum" 1;
            letter-spacing: -0.005em;
          }
          /* Specificity bump so AG Grid's .ag-theme-quartz .ag-cell doesn't
             outrank .seqout-accession on grid cells. */
          .ag-cell.seqout-accession,
          .ag-cell.seqout-accession a {
            font-family: var(--code-font-family);
            font-feature-settings: "ss01" 1, "ss03" 1, "tnum" 1;
            letter-spacing: -0.005em;
          }

          body {
            font-feature-settings: "ss01" 1, "cv11" 1;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          .seqout-divided-list > * + * {
            border-top: 1px solid var(--gray-a4);
          }

          .seqout-inline-link {
            color: var(--gray-12);
            text-decoration: underline;
            text-decoration-color: var(--gray-a6);
            text-underline-offset: 2px;
            transition:
              color 120ms ease-out,
              text-decoration-color 120ms ease-out;
          }
          .seqout-inline-link:hover {
            color: var(--accent-11);
            text-decoration-color: var(--accent-8);
          }

          /* Skip-to-content link (WCAG 2.2 § 2.4.1 Bypass Blocks). */
          .seqout-skip-link {
            position: fixed;
            top: -60px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 3000;
            padding: 0.75rem 1.25rem;
            background: var(--accent-9);
            color: var(--accent-contrast);
            font-size: 0.875rem;
            font-weight: 500;
            text-decoration: none;
            border-radius: 0 0 var(--radius-3) var(--radius-3);
            box-shadow: 0 4px 16px var(--black-a6);
            transition: top 160ms cubic-bezier(0.25, 1, 0.5, 1);
          }
          .seqout-skip-link:focus,
          .seqout-skip-link:focus-visible {
            top: 0;
            outline: 2px solid var(--accent-12);
            outline-offset: 2px;
          }
          @media (prefers-reduced-motion: reduce) {
            .seqout-skip-link {
              transition: none;
            }
          }

          :focus-visible {
            outline-color: var(--accent-8);
            outline-offset: 2px;
          }
          /* Let Radix primitives keep their own focus styles. */
          .rt-reset:focus-visible,
          .rt-BaseButton:focus-visible,
          .rt-IconButton:focus-visible,
          .rt-TextFieldInput:focus-visible,
          .rt-SelectTrigger:focus-visible {
            outline-color: revert;
            outline-offset: revert;
          }

          .seqout-paginator-btn {
            min-width: 2.5rem;
          }
          @media (min-width: 1024px) {
            .seqout-paginator-btn {
              min-width: 2rem;
            }
          }

          .seqout-sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }

          @keyframes seqout-toast-enter {
            from {
              opacity: 0;
              transform: translateY(8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .seqout-toast {
            animation: seqout-toast-enter 220ms cubic-bezier(0.25, 1, 0.5, 1);
          }
          @media (prefers-reduced-motion: reduce) {
            .seqout-toast {
              animation: none;
            }
          }

          .ag-theme-quartz,
          .ag-theme-quartz-dark {
            --ag-font-family:
              var(--font-geist-sans),
              ui-sans-serif, system-ui, -apple-system, sans-serif;
          }
          .ag-theme-quartz .ag-cell,
          .ag-theme-quartz-dark .ag-cell {
            font-feature-settings: "tnum" 1, "cv11" 1;
          }

          /* Flex items need min-width: 0 or AG Grid expands to the full
             sum of column widths instead of scrolling internally. */
          .ag-theme-quartz,
          .ag-theme-quartz-dark {
            min-width: 0;
            max-width: 100%;
            width: 100%;
            box-sizing: border-box;
          }
          .rt-Flex:has(.ag-theme-quartz),
          .rt-Flex:has(.ag-theme-quartz-dark) {
            min-width: 0;
          }
          .rt-Box:has(.ag-theme-quartz),
          .rt-Box:has(.ag-theme-quartz-dark),
          .rt-Container:has(.ag-theme-quartz),
          .rt-Container:has(.ag-theme-quartz-dark) {
            min-width: 0;
          }

          .ag-theme-quartz,
          .ag-theme-quartz-dark {
            --ag-scroll-bar-thickness: 14px;
          }
          .ag-theme-quartz .ag-body-horizontal-scroll,
          .ag-theme-quartz-dark .ag-body-horizontal-scroll {
            height: 14px !important;
            min-height: 14px !important;
            max-height: 14px !important;
          }
          /* Firefox */
          .ag-theme-quartz .ag-body-horizontal-scroll-viewport,
          .ag-theme-quartz-dark .ag-body-horizontal-scroll-viewport {
            scrollbar-width: auto;
            scrollbar-color: var(--accent-9) var(--gray-4);
          }
          /* WebKit / Blink (Chrome, Safari, Edge) */
          .ag-theme-quartz .ag-body-horizontal-scroll-viewport::-webkit-scrollbar,
          .ag-theme-quartz-dark .ag-body-horizontal-scroll-viewport::-webkit-scrollbar {
            height: 14px;
            background-color: var(--gray-4);
          }
          .ag-theme-quartz .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb,
          .ag-theme-quartz-dark .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb {
            background-color: var(--accent-9);
            border: 2px solid var(--gray-4);
            border-radius: 7px;
            min-width: 40px;
          }
          .ag-theme-quartz .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb:hover,
          .ag-theme-quartz-dark .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb:hover {
            background-color: var(--accent-10);
          }
          .ag-theme-quartz .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-track,
          .ag-theme-quartz-dark .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-track {
            background-color: var(--gray-4);
            border-radius: 7px;
          }
          .ag-theme-quartz .ag-body-horizontal-scroll,
          .ag-theme-quartz-dark .ag-body-horizontal-scroll {
            border-top: 1px solid var(--gray-5);
          }
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
      <body suppressHydrationWarning>
        <a href="#main-content" className="seqout-skip-link">
          Skip to content
        </a>
        <Wrapper>
          <div id="main-content" tabIndex={-1} style={{ outline: "none" }}>
            {children}
          </div>
          <FooterGate />
        </Wrapper>
      </body>
    </html>
  );
}
