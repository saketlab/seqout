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
      // Grammarly opt-out — the extension mutates <a> and form elements
      // before React hydrates, causing noisy dev-mode hydration warnings.
      // Grammarly documents these attributes as the official opt-out.
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

          /* --- Typography: Geist (Sans + Mono) overrides for Radix Themes --- */
          /* Set Radix Themes font family CSS variables to Geist via next/font. */
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

          /* Geist looks best with subtle negative tracking on display sizes
             and is naturally tight at body size (leave default tracking). */
          .rt-Heading {
            letter-spacing: -0.015em;
          }
          .rt-Heading[data-size="6"],
          .rt-Heading[data-size="7"],
          .rt-Heading[data-size="8"],
          .rt-Heading[data-size="9"] {
            letter-spacing: -0.022em;
          }

          /* Page titles rendered as <Text size="6"|"7"|"8"> with weight="bold"
             — apply the same display tracking. */
          .rt-Text[data-size="6"][data-weight="bold"],
          .rt-Text[data-size="7"][data-weight="bold"],
          .rt-Text[data-size="8"][data-weight="bold"],
          .rt-Text[data-size="9"][data-weight="bold"] {
            letter-spacing: -0.022em;
          }

          /* Tabular numerals everywhere numbers carry meaning:
             counts, badges, citations, dates, table cells. */
          .rt-Badge,
          .rt-TableCell,
          .ag-cell {
            font-variant-numeric: tabular-nums;
            font-feature-settings: "tnum" 1, "cv11" 1;
          }

          /* Accession codes (GSE..., SRP..., E-MTAB-...) render in Geist Mono
             via this utility. Used in result cards, project headers, error
             copy, and AG Grid cells (via cellClass). */
          .seqout-accession {
            font-family: var(--code-font-family);
            font-feature-settings: "ss01" 1, "ss03" 1, "tnum" 1;
            letter-spacing: -0.005em;
          }
          /* AG Grid's .ag-theme-quartz .ag-cell selector (specificity 0,2,0)
             would otherwise outrank plain .seqout-accession (0,1,0). Match
             specificity with this same-rank rule so cellClass works. */
          .ag-cell.seqout-accession,
          .ag-cell.seqout-accession a {
            font-family: var(--code-font-family);
            font-feature-settings: "ss01" 1, "ss03" 1, "tnum" 1;
            letter-spacing: -0.005em;
          }

          /* Geist Sans benefits from these OpenType features at body size. */
          body {
            font-feature-settings: "ss01" 1, "cv11" 1;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          /* Card-less list separation: a hairline border between adjacent
             siblings, leaving the first child unborderedso there's no
             redundant edge at the top of the list. Replaces the
             Radix <Card> wrapper on result and publication cards. */
          .seqout-divided-list > * + * {
            border-top: 1px solid var(--gray-a4);
          }

          /* Inline keyword links — used in the homepage teaching copy
             ("organism, disease, gene, method"). Slightly stronger than
             the surrounding muted prose, with a subtle underline that
             warms to the brand accent on hover. */
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

          /* Skip-to-content link — visually hidden until focused, then
             slides down into view at the top of the viewport. WCAG 2.2
             § 2.4.1 (Bypass Blocks) — lets keyboard + screen reader users
             jump past the sticky search bar and nav items. */
          .seqout-skip-link {
            position: fixed;
            top: -60px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 3000;
            padding: 0.75rem 1.25rem;
            background: var(--accent-9);
            color: white;
            font-size: 0.875rem;
            font-weight: 500;
            text-decoration: none;
            border-radius: 0 0 var(--radius-3) var(--radius-3);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
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

          /* Global :focus-visible fallback — consistent indigo outline
             on any interactive element that doesn't already have Radix
             Themes focus styles. 2px outline + 2px offset matches the
             skip-link treatment and is visible on both themes. */
          :focus-visible {
            outline-color: var(--accent-8);
            outline-offset: 2px;
          }
          /* Don't double-outline Radix primitives that already handle it. */
          .rt-reset:focus-visible,
          .rt-BaseButton:focus-visible,
          .rt-IconButton:focus-visible,
          .rt-TextFieldInput:focus-visible,
          .rt-SelectTrigger:focus-visible {
            outline-color: revert;
            outline-offset: revert;
          }

          /* Global toast — enters with a subtle fade + slide-up using
             ease-out-quart (natural deceleration). Respects the user's
             reduced-motion preference by dropping the translate. */
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

          /* AG Grid: inherit the Geist sans/mono stack. */
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

          /* AG Grid horizontal scroll fix.
             Inside Radix Flex containers, a flex item expands to its
             intrinsic content width unless min-width: 0 is set. Without
             this, AG Grid renders at the full sum of column widths and
             the page scrolls horizontally (or columns spill outside the
             content area) instead of the grid scrolling internally.
             We pin the grid wrapper to its parent's width and let any
             ancestor Flex that contains a grid shrink properly. */
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
          /* Belt-and-braces: also apply to Box, Container, and section
             wrappers that contain a grid. */
          .rt-Box:has(.ag-theme-quartz),
          .rt-Box:has(.ag-theme-quartz-dark),
          .rt-Container:has(.ag-theme-quartz),
          .rt-Container:has(.ag-theme-quartz-dark) {
            min-width: 0;
          }

          /* Make AG Grid's horizontal scrollbar obvious when columns
             overflow. Default scrollbar is 8px and easy to miss in
             dense data tables; bump to 14px and tint with the brand
             accent so users immediately see scrolling is available. */
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
          /* When the scroll viewport actually has overflow content, the
             AG Grid root gets a subtle indigo border-bottom on the body
             scroll bar so users notice it as an interactive surface. */
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
        {/* Skip link — must be the first focusable element in the body so
            keyboard users can bypass the sticky search bar + nav on every
            route. Targets a tabindex="-1" wrapper around the page content
            so activating it moves focus into the content tree. */}
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
