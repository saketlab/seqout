import OntologyGraphFigure from "@/components/ontology-graph-figure";
import SectionAnchor from "@/components/section-anchor";
import SearchBar from "@/components/search-bar";
import { Code, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "How search works",
  description:
    "How to search seqout. Write plain keywords, skip AND/OR operators, let synonym expansion work, and use filters to get better results across GEO, SRA, ENA, DRA, GEA, GSA & ArrayExpress.",
  alternates: {
    canonical: "https://seqout.org/howsearchworks",
  },
};

// Written in Simplified Technical English (ASD-STE100): short sentences, active
// voice, present tense, one instruction per sentence, consistent terms.
const tips: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "plain-keywords",
    title: "Write plain keywords",
    body: (
      <>
        Type the words that describe the dataset. Do not write a full question
        or a long sentence. Use a small number of specific words. The search
        finds datasets that contain your words, and it sorts them by relevance.
        <Examples
          good="crispr screen liver"
          avoid="Please show me all the studies about CRISPR screens in the liver"
        />
      </>
    ),
  },
  {
    id: "no-operators",
    title: "Do not use AND, OR, or NOT",
    body: (
      <>
        The search box does not use <Code>AND</Code>, <Code>OR</Code>, or{" "}
        <Code>NOT</Code> as commands. It reads them as normal words. A query
        like <Code>cancer AND mouse</Code> also looks for the word{" "}
        <Code>and</Code>. This gives worse results. Write only the keywords.
        <Examples good="cancer mouse" avoid="cancer AND mouse" />
      </>
    ),
  },
  {
    id: "no-symbols",
    title: "Do not add quotation marks or symbols",
    body: (
      <>
        Write words only. Quotation marks, plus signs, and other symbols do not
        change the search. They can reduce your results.
        <Examples good="single cell rna" avoid={`"single cell" +rna`} />
      </>
    ),
  },
  {
    id: "synonyms",
    title: "Let the search find synonyms for you",
    body: (
      <>
        The search adds synonyms, abbreviations, and related terms for you. You
        do not need to list them. A search for{" "}
        <Code>lou gehrig disease</Code> also finds datasets that use{" "}
        <Code>ALS</Code> or <Code>amyotrophic lateral sclerosis</Code>. A search
        for <Code>atacseq</Code> also finds <Code>atac seq</Code>. Write the one
        term that you know. The search finds the others.
      </>
    ),
  },
  {
    id: "use-filters",
    title: "Use filters for organism, platform, and dates",
    body: (
      <>
        Do not type the organism, the instrument, the country, the library
        strategy, the journal, or the date in the search box. Use the filters
        next to the results for these. The filters are faster and more exact.
        First search for <Code>t cell exhaustion</Code>. Then use the organism
        filter to keep only human datasets.
      </>
    ),
  },
  {
    id: "spelling",
    title: "Check the spelling suggestion",
    body: (
      <>
        A small spelling mistake can hide good datasets. If a search returns few
        results or no results, the search shows a <Code>Did you mean</Code>{" "}
        suggestion. Click the suggestion to correct your query.
      </>
    ),
  },
];

// KaTeX rendered at request time (server component), so no client JS ships. The
// CSS import above loads the KaTeX fonts. `inline` renders a <span> for use in
// prose; the default renders a centered display equation.
function Tex({ tex, inline = false }: { tex: string; inline?: boolean }) {
  const html = katex.renderToString(tex, {
    displayMode: !inline,
    throwOnError: false,
  });
  if (inline) {
    return (
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output
      <span dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return (
    <div
      style={{ overflowX: "auto" }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Examples({ good, avoid }: { good: string; avoid: string }) {
  return (
    <Flex direction="column" gap="2" mt="3">
      <Text size="2">
        <Text weight="medium" style={{ color: "var(--green-11)" }}>
          Good:
        </Text>{" "}
        <Code>{good}</Code>
      </Text>
      <Text size="2">
        <Text weight="medium" style={{ color: "var(--red-11)" }}>
          Avoid:
        </Text>{" "}
        <Code>{avoid}</Code>
      </Text>
    </Flex>
  );
}

export default function HowSearchWorks() {
  return (
    <>
      <SearchBar />
      <Flex
        gap="4"
        py={{ initial: "4", md: "4" }}
        px={{ initial: "4", md: "0" }}
        ml={{ initial: "0", md: "13rem" }}
        mr={{ initial: "0", md: "16rem" }}
        direction="column"
      >
        <Flex align="center" gap="2" id="how-search-works">
          <Heading as="h1" size={{ initial: "6", md: "8" }} weight="bold">
            How search works
          </Heading>
          <SectionAnchor id="how-search-works" />
        </Flex>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          The search box does a full-text search. It looks in the title, the
          description, the sample metadata, the organizations, and the authors
          of each dataset. Sample metadata includes fields such as tissue, cell
          type, and disease. A match in the title counts more than a match in
          the description. Many studies are in more than one archive, for
          example GEO and SRA. The search removes the copies and shows each
          study one time. The tips below help you write good queries and avoid
          common mistakes.
        </Text>

        <Separator size="4" />

        {tips.map((tip) => (
          <Flex key={tip.id} direction="column" gap="3" id={tip.id}>
            <Flex align="center" gap="2">
              <Heading as="h2" size={{ initial: "4", md: "5" }} weight="medium">
                {tip.title}
              </Heading>
              <SectionAnchor id={tip.id} />
            </Flex>
            <Text
              size={{ initial: "2", md: "3" }}
              style={{ color: "var(--gray-11)" }}
            >
              {tip.body}
            </Text>
          </Flex>
        ))}

        <Separator size="4" />

        <Flex align="center" gap="2" id="ranking">
          <Heading as="h2" size={{ initial: "5", md: "7" }} weight="bold">
            How results are ranked
          </Heading>
          <SectionAnchor id="ranking" />
        </Flex>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          The search gives each field a weight. The title has the highest weight
          (<Code>A</Code>). Then comes the description or summary (<Code>B</Code>
          ), then the organizations (<Code>C</Code>), then the authors (
          <Code>D</Code>). Sample metadata is also indexed. A word in the title
          therefore counts more than the same word in a lower field.
        </Text>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          The search builds two queries from your text. The first query,{" "}
          <Tex inline tex="Q_{\text{orig}}" />, is your text as you typed it. The
          second query, <Tex inline tex="Q_{\text{expanded}}" />, is your text
          joined with all of its synonyms and related terms by <Code>OR</Code>. A
          dataset is a match when it satisfies{" "}
          <Tex inline tex="Q_{\text{expanded}}" />. The search then gives each
          matching dataset a relevance score:
        </Text>

        <Tex tex="\text{score} = \left[\, \operatorname{ts\_rank}(\text{tsv}, Q_{\text{orig}}) + 0.2 \cdot \operatorname{ts\_rank}(\text{tsv}, Q_{\text{expanded}}) \,\right] \cdot s" />

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          The function <Tex inline tex="\operatorname{ts\_rank}" /> measures how
          strongly a dataset matches a query. Your original words count at full
          weight. The synonyms count at <Tex inline tex="0.2" />, so they add
          recall but do not push weak matches to the top. The factor{" "}
          <Tex inline tex="s" /> is a small tie-break between archives. It is{" "}
          <Tex inline tex="s = 1" /> for GEO records and <Tex inline tex="s = 0.7" />{" "}
          for the other sources. So when the same study is in more than one
          archive, the GEO copy surfaces first. The search removes the duplicate
          copies and shows each study one time.
        </Text>

        <Separator size="4" />

        <Flex align="center" gap="2" id="ontology-graph">
          <Heading as="h2" size={{ initial: "5", md: "7" }} weight="bold">
            Where the synonyms come from
          </Heading>
          <SectionAnchor id="ontology-graph" />
        </Flex>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          The synonyms come from an ontology graph. In this graph, each node is a
          biomedical term. An edge joins a term to its synonyms and aliases, or
          joins a term to a broader or a narrower term. So the graph holds both
          equal names for the same thing and the parent&ndash;child hierarchy
          between things.
        </Text>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          The graph is built from established biomedical ontologies. These cover
          diseases, anatomy, cell types, genes, chemicals, and cell lines. Each
          term becomes one shared node, so ontologies that use the same word join
          onto the same node. When you search, the search matches your term
          against the graph and follows its synonym edges. This is how a search
          for one name also finds datasets that use another name for the same
          concept.
        </Text>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          As an example, the graph below shows the term <Code>nafld</Code> at the
          center with its synonyms around it. Each <Code>MAPS_TO</Code> edge joins
          an equivalent name for the same concept. This is how the search finds
          datasets that use another name for what you typed.
        </Text>

        <OntologyGraphFigure />

        <Separator size="4" />

        <Flex align="center" gap="2" id="expansion">
          <Heading as="h2" size={{ initial: "5", md: "7" }} weight="bold">
            How synonym expansion is bounded
          </Heading>
          <SectionAnchor id="expansion" />
        </Flex>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          The search splits your query into chunks. A chunk is a term such as{" "}
          <Code>nafld</Code> or <Code>scrna</Code>. For each chunk{" "}
          <Tex inline tex="c_i" />, the search collects its synonyms{" "}
          <Tex inline tex="S_i" />. The set of alternatives for that chunk is the
          original word together with its synonyms:
        </Text>

        <Tex tex="A_i = \{o_i\} \cup S_i, \qquad |A_i| = 1 + |S_i|" />

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          A query variant replaces every chunk with one of its alternatives. The
          number of variants is the product of the per-chunk counts:
        </Text>

        <Tex tex="V = \prod_{i=1}^{k} \left(1 + |S_i|\right)" />

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          This product grows fast. One chunk with many synonyms can create
          hundreds of variants. So the search keeps only the first{" "}
          <Tex inline tex="N_{\max}" /> variants:
        </Text>

        <Tex tex="V_{\text{out}} = \min(V, N_{\max}), \qquad N_{\max} = 48" />

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          The search lists your original text first. So your exact query always
          runs, even after truncation. Only the extra variants beyond 48 are
          dropped. This is one more reason to use few, specific keywords: a very
          broad term can fill the variant budget on its own.
        </Text>

        <Text size={{ initial: "2", md: "3" }} style={{ color: "var(--gray-11)" }}>
          For example, the query <Code>nafld scrna</Code> has two chunks. The
          chunk <Code>nafld</Code> has 11 alternatives, such as{" "}
          <Code>non alcoholic fatty liver disease</Code> and <Code>masld</Code>.
          The chunk <Code>scrna</Code> has 4 alternatives, such as{" "}
          <Code>single cell rna sequencing</Code>. This gives{" "}
          <Tex inline tex="V = 11 \times 4 = 44" /> variants. All 44 fit under
          the limit of 48, so the search uses all of them. Two of these variants
          are <Code>non alcoholic fatty liver disease single cell rna sequencing</Code>{" "}
          and <Code>masld scrna</Code> &mdash; both find datasets that the words{" "}
          <Code>nafld scrna</Code> alone would miss.
        </Text>
      </Flex>
    </>
  );
}
