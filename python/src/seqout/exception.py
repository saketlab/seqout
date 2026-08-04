class SeqoutError(Exception):
    """
    Raised when seqout cannot answer a lookup.

    The message names what was tried, so an accession with no path back to its
    study says which endpoints were asked and what to do instead.
    """

    def __init__(self, message: str) -> None:
        """Initialize the error with a message."""
        super().__init__(message)
        self.message = message
