from collections import Counter

from seqoutdb import SearchParams, Seqout

with Seqout() as sq:
    response = sq.search(params=SearchParams(q="brca-1"))
    org_counter: Counter[str] = Counter()

    for res in response.results:
        for org in res.organisms:
            org_counter[org] += 1

    print(org_counter)
