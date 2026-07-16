import ClickTracker from "@/components/click-tracker";
import FooterGate from "@/components/footer-gate";
import Wrapper from "@/components/wrapper";
import { BRAND_BG } from "@/utils/constants";
import { escapeHtmlJson } from "@/utils/json";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import "@radix-ui/themes/styles.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Source_Serif_4 } from "next/font/google";
import type { Metadata, Viewport } from "next";
import Script from "next/script";

const GA_TRACKING_ID = "G-XF18RH7984";

// Serif accent for paper titles. Self-hosted at build time by next/font, so it
// costs no request to Google. Variable font — no weight list needed.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-source-serif",
});

export const viewport: Viewport = {
  themeColor: BRAND_BG,
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "seqout - Search GEO, SRA, ENA, DRA, GEA, GSA & ArrayExpress",
    template: "%s | seqout",
  },
  description:
    "Fast exploration of GEO, SRA, ENA, DRA, GEA, GSA & ArrayExpress datasets. Search millions of experiments with unified metadata, relevance-ranked results, and consolidated sample tables. Developed at Saket Lab, IIT Bombay.",
  applicationName: "seqout",
  keywords: [
    "seqout",
    "pysradb",
    "pysraweb",
    "SRA metadata search",
    "GEO metadata search",
    "ENA metadata search",
    "GSA metadata search",
    "NGDC GSA search",
    "DDBJ metadata search",
    "DRA metadata search",
    "GEA metadata search",
    "ArrayExpress metadata search",
    "SRA bulk metadata",
    "GEO bulk metadata",
    "ENA bulk metadata",
    "GSA bulk metadata",
    "DDBJ bulk metadata",
    "ArrayExpress bulk metadata",
    "sequencing metadata discovery",
    "harmonized metadata SRA",
    "harmonized metadata GEO",
    "harmonized metadata ENA",
    "harmonized metadata GSA",
    "harmonized metadata DDBJ",
    "harmonized metadata ArrayExpress",
    "SRA metadata",
    "GEO metadata",
    "ENA metadata",
    "GSA metadata",
    "DDBJ metadata",
    "DRA metadata",
    "GEA metadata",
    "ArrayExpress metadata",
    "sequencing data discovery",
    "metadata search sequencing",
    "SRA",
    "GEO",
    "ENA",
    "GSA",
    "DDBJ",
    "DRA",
    "GEA",
    "ArrayExpress",
    "Sequence Read Archive",
    "Gene Expression Omnibus",
    "European Nucleotide Archive",
    "Genome Sequence Archive",
    "DDBJ DRA",
    "DDBJ GEA",
    "DNA Data Bank of Japan",
    "DDBJ Sequence Read Archive",
    "Genomic Expression Archive",
    "National Institute of Genetics",
    "DRP accession",
    "E-GEAD accession",
    "PRJDB",
    "GSA NGDC",
    "NGDC",
    "CNCB",
    "CNCB-NGDC",
    "China National Center for Bioinformation",
    "National Genomics Data Center",
    "CRA accession",
    "HRA accession",
    "PRJCA",
    "NCBI",
    "EBI",
    "NIG",
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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico",
  },
  appleWebApp: {
    capable: true,
    title: "seqout",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://seqout.org",
    siteName: "seqout",
    title: "seqout - Search GEO, SRA, ENA, DRA, GEA, GSA & ArrayExpress",
    description:
      "Fast exploration of GEO, SRA, ENA, DRA, GEA, GSA & ArrayExpress datasets. Search millions of experiments with unified metadata and relevance-ranked results.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "seqout - GEO, SRA, ENA, DRA, GEA, GSA & ArrayExpress Dataset Search",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "seqout - Search GEO, SRA, ENA, DRA, GEA, GSA & ArrayExpress",
    description:
      "Fast exploration of GEO, SRA, ENA, DRA, GEA, GSA & ArrayExpress datasets. Search millions of experiments with unified metadata.",
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

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "seqout",
  url: "https://seqout.org",
  publisher: { "@id": "https://seqout.org/#organization" },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: "https://seqout.org/search?q={search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://seqout.org/#organization",
  name: "Saket Lab, IIT Bombay",
  url: "https://seqout.org",
  logo: "https://seqout.org/logo-dark.svg",
  sameAs: ["https://saketlab.org", "https://github.com/saketlab/seqout"],
};

function LayoutStructuredData() {
  return (
    <>
      <script type="application/ld+json">
        {escapeHtmlJson(WEBSITE_JSON_LD)}
      </script>
      <script type="application/ld+json">
        {escapeHtmlJson(ORGANIZATION_JSON_LD)}
      </script>
    </>
  );
}

function RootBody({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <body suppressHydrationWarning>
      <ClickTracker />
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
  );
}

function AnalyticsScripts() {
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`}
        strategy="lazyOnload"
      />
      <Script id="google-analytics" strategy="lazyOnload">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_TRACKING_ID}');
        `}
      </Script>
    </>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      suppressHydrationWarning
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${sourceSerif.variable}`}
      data-gramm="false"
      data-gramm_editor="false"
      data-enable-grammarly="false"
    >
      <head>
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
        <LayoutStructuredData />
        <style
          dangerouslySetInnerHTML={{
            __html: `
          .db-badge {
            background-color: color-mix(in srgb, var(--db) 15%, transparent);
            color: var(--db-fg);
          }
          .dark .db-badge {
            background-color: color-mix(in srgb, var(--db) 22%, transparent);
            color: var(--db-fg-dark);
          }

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

          /* Sticky footer. Radix's theme root already carries min-height:100vh,
             but as a block box a short page stacks main+footer at the top and
             strands the footer mid-viewport. Flex column + a growing main pins
             it to the bottom. The -16px offsets body's default 8px margin
             (there's no reset), which otherwise pushes every page 16px past
             the fold.
             Keyed to .seqout-root-theme, NOT .radix-themes: portalled popovers
             and dialogs render their own nested .radix-themes, and would
             inherit this min-height and balloon to full viewport height. */
          .seqout-root-theme {
            display: flex;
            flex-direction: column;
            min-height: calc(100vh - 16px);
          }
          #main-content {
            flex: 1 0 auto;
          }

          .seqout-accession {
            font-family: var(--code-font-family);
            font-feature-settings: "ss01" 1, "ss03" 1, "tnum" 1;
            letter-spacing: -0.005em;
          }

          /* Serif for paper titles, the way a journal would set them —
             identifiers get mono above, prose from the literature gets this. */
          .seqout-paper-title {
            font-family: var(--font-source-serif), Georgia, serif;
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

          @keyframes ping {
            75%, 100% {
              transform: scale(2);
              opacity: 0;
            }
          }
          .animate-ping {
            animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .animate-ping {
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
        `,
          }}
        />
        <AnalyticsScripts />
      </head>
      <RootBody>{children}</RootBody>
    </html>
  );
}
