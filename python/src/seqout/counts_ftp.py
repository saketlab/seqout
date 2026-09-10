"""
FTP transport for supplementary files, with HTTPS fallback.

FTP SIZE detects truncation; hard FTP failures route subsequent transfers to HTTPS.
SEQOUT_SOCKS_PROXY=host:port requires pysocks.
"""

from __future__ import annotations

import contextlib
import ftplib
import logging
import os
import socket
from typing import TYPE_CHECKING
from urllib.parse import urlparse

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

logger = logging.getLogger(__name__)

_TIMEOUT = 60

_ftp_blocked = False


def ftp_unavailable() -> bool:
    return _ftp_blocked


def _mark_unavailable(reason: str) -> None:
    global _ftp_blocked  # noqa: PLW0603
    if not _ftp_blocked:
        logger.info("FTP unusable (%s); using HTTPS for the rest of this run", reason)
    _ftp_blocked = True


@contextlib.contextmanager
def _socks_socket() -> Iterator[None]:
    """Route new sockets through SOCKS5 when SEQOUT_SOCKS_PROXY is set."""
    proxy = os.environ.get("SEQOUT_SOCKS_PROXY", "").strip()
    if not proxy:
        yield
        return

    import socks  # noqa: PLC0415

    host, _, port = proxy.partition(":")
    original = socket.socket
    socks.set_default_proxy(socks.SOCKS5, host, int(port or "1080"))
    socket.socket = socks.socksocket
    try:
        yield
    finally:
        socket.socket = original


def _connect(host: str) -> ftplib.FTP:
    # NCBI dual-stack FTP needs an explicit IPv4 address for pysocks
    addr = str(socket.getaddrinfo(host, 21, socket.AF_INET)[0][4][0])
    ftp = ftplib.FTP(timeout=_TIMEOUT)  # noqa: S321
    ftp.connect(addr, 21)
    ftp.login("anonymous", "guest@")
    ftp.set_pasv(True)
    ftp.voidcmd("TYPE I")
    return ftp


def fetch(url: str, dest: Path) -> bool:
    """
    Download one ftp:// or HTTPS-mirrored FTP URL.

    False asks the caller to use HTTPS. The .part file is renamed after SIZE
    matches, so interrupted transfers stay out of cache.
    """
    if _ftp_blocked:
        return False

    parsed = urlparse(url.replace("https://", "ftp://", 1))
    if not parsed.hostname or not parsed.path:
        return False

    part = dest.with_suffix(dest.suffix + ".part")
    try:
        with _socks_socket():
            ftp = _connect(parsed.hostname)
            try:
                expected = ftp.size(parsed.path)
                dest.parent.mkdir(parents=True, exist_ok=True)
                with part.open("wb") as f:
                    ftp.retrbinary(f"RETR {parsed.path}", f.write, blocksize=1 << 20)
            finally:
                with contextlib.suppress(Exception):
                    ftp.quit()
    except ftplib.all_errors as e:  # ftplib.all_errors already includes OSError.
        part.unlink(missing_ok=True)
        # port 21 refusal marks FTP unusable for the run
        if isinstance(
            e, (socket.gaierror, ConnectionError, socket.timeout, ftplib.error_proto)
        ):
            _mark_unavailable(f"{type(e).__name__}: {e}")
        else:
            logger.debug("FTP failed for %s (%s); falling back to HTTPS", url, e)
        return False

    got = part.stat().st_size
    if expected is not None and got != expected:
        logger.warning(
            "FTP short read for %s: %d of %d bytes, falling back to HTTPS",
            url,
            got,
            expected,
        )
        part.unlink(missing_ok=True)
        return False

    part.rename(dest)
    return True
