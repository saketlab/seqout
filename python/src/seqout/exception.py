class SeqoutError(Exception):
    def __init__(self, message: str) -> None:
        """Initialize the error with a message."""
        super().__init__(message)
        self.message = message
