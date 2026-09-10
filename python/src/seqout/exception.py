class SeqoutError(Exception):
    """
    Raised when seqout cannot answer a lookup.

    The message names tried routes and the next action.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
