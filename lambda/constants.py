MAX_URL_LENGTH = 2048
MIN_EXPIRY_DAYS = 1
MAX_EXPIRY_DAYS = 3650  # 10 years
DEFAULT_EXPIRY_DAYS = 365  # 1 year
MAX_RETRIES = 3
SECONDS_PER_DAY = 24 * 60 * 60
SECONDS_PER_HOUR = 3600
# Constants
MIN_URL_LENGTH = 3
ALLOWED_SCHEMES = {"http", "https"}

# Security related constants
BLOCKED_DOMAINS = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "internal",
    "local",
    "intranet",
    "private",
}
BLOCKED_TLDS = {"local", "internal", "localhost", "invalid", "test"}
SECURITY_PATTERNS = {
    r"..//",  # Directory traversal
    "@",  # URL credentials
    "data:",  # Data URLs
    "javascript:",  # JavaScript URLs
    "vbscript:",  # VBScript URLs
    "file:",  # File protocol
    r"\\",  # Backslash
    r"0x",  # Hex encoding
    "%00",  # Null byte
    "%0d",  # Carriage return
    "%0a",  # Line feed
}
