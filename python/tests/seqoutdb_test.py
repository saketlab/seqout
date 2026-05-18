from seqoutdb import SearchParams, Seqout

with Seqout() as sq:
    results = sq.search(params=SearchParams(q="whole genome sequencing"))
    print(len(results.by_organism("homo sapiens")))
