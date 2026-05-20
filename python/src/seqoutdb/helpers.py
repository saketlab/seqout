import queue
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from tqdm import tqdm

from seqoutdb.utils import _verify_file


def _run_parallel_downloads(
    futures: dict[Future, str],
    queue: queue.Queue[tuple[str, str, int | None]] | None,
    url_to_dest: dict[str, Path],
) -> list[tuple[str, Exception]]:
    failed: list[tuple[str, Exception]] = []

    if queue is not None:
        pbars: dict[str, tqdm] = {}
        pending = len(futures)

        while pending > 0:
            try:
                url, kind, value = queue.get(timeout=0.5)
            except Exception:
                all_done = all(f.done() for f in futures)
                if all_done and queue.empty():
                    break
                continue

            if kind == "total":
                pbars[url] = tqdm(
                    total=value,
                    unit="B",
                    unit_scale=True,
                    unit_divisor=1024,
                    desc=url_to_dest[url].name,
                    dynamic_ncols=True,
                )
            elif kind == "update":
                if url in pbars:
                    pbars[url].update(value)
            elif kind == "done":
                if url in pbars:
                    pbars[url].close()
                pending -= 1

        for bar in pbars.values():
            if not bar.disable:
                bar.close()

    for future, url in futures.items():
        try:
            future.result()
        except Exception as e:
            failed.append((url, e))

    return failed


def _verify_downloads(
    verify_plan: list[tuple[Path, int, str]], n_workers: int
) -> list[tuple[str, str]]:
    failed: list[tuple[str, str]] = []

    with ThreadPoolExecutor(max_workers=n_workers) as pool:
        futures = {
            pool.submit(_verify_file, path, bytes, md5): path
            for path, bytes, md5 in verify_plan
        }

        with tqdm(total=len(futures), unit="file", desc="verifying download") as pbar:
            for future in futures:
                filename, passed, reason = future.result()
                if not passed:
                    failed.append((filename, reason))
                pbar.update(1)

    return failed
