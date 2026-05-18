from seqoutdb import SearchParams, Seqout, StructuredSearchParams

with Seqout() as sq:
    results = sq.bulk_search(
        [
            SearchParams(q="oxford nanopore"),
            StructuredSearchParams(
                q="breat cancer", organism="Homo sapiens", country="china"
            ),
            SearchParams(q="crispr"),
        ]
    )

    print(results)
