import ipaddress
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional, Tuple
from urllib.parse import urlparse

from constants import (
    ALLOWED_SCHEMES,
    BLOCKED_DOMAINS,
    BLOCKED_TLDS,
    DEFAULT_EXPIRY_DAYS,
    MAX_EXPIRY_DAYS,
    MAX_URL_LENGTH,
    MIN_EXPIRY_DAYS,
    MIN_URL_LENGTH,
    SECURITY_PATTERNS,
)

# Configure logger
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ExpiryValidationResult:
    """
    Data class to hold validation results for expiry days

    Attributes:
        is_valid (bool): Whether the expiry days value is valid
        error_message (Optional[str]): Error message if validation fails
        normalized_days (Optional[int]): Normalized days value if validation succeeds
    """

    is_valid: bool
    error_message: Optional[str] = None
    normalized_days: Optional[int] = None


# Custom Exceptions
class URLValidationError(Exception):
    """Base exception for URL validation"""

    pass


class URLSecurityError(URLValidationError):
    """Raised for security-related validation failures"""

    pass


class URLFormatError(URLValidationError):
    """Raised for format-related validation failures"""

    pass


@dataclass
class ValidationResult:
    """Data class to hold validation results"""

    is_valid: bool
    error_message: Optional[str] = None
    security_warning: Optional[str] = None


def format_timestamp(timestamp: int, with_timezone: bool = True) -> str:
    """
    Format Unix timestamp to ISO 8601 string with timezone

    Args:
        timestamp (int): Unix timestamp
        with_timezone (bool): Whether to include timezone suffix

    Returns:
        str: Formatted datetime string

    Examples:
        >>> format_timestamp(1640995200)
        '2022-01-01T00:00:00.000000Z'
        >>> format_timestamp(1640995200, False)
        '2022-01-01T00:00:00.000000'
    """
    dt = datetime.fromtimestamp(timestamp, timezone.utc)
    formatted = dt.isoformat()

    if with_timezone and not formatted.endswith("Z"):
        if formatted.endswith("+00:00"):
            formatted = formatted[:-6] + "Z"
        else:
            formatted += "Z"

    return formatted


def is_private_ip(ip_str: str) -> bool:
    """
    Check if an IP address is private

    Args:
        ip_str (str): IP address to check

    Returns:
        bool: True if IP is private, False otherwise
    """
    try:
        ip = ipaddress.ip_address(ip_str)
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
        )
    except ValueError:
        return False


def validate_url(url: str) -> Tuple[bool, Optional[str]]:
    """
    Validate URL format and security with comprehensive checks.
    Uses hybrid approach of returns and exceptions for different scenarios.

    Args:
        url (str): URL to validate

    Returns:
        Tuple[bool, Optional[str]]: (is_valid, error_message)
            - First element is boolean indicating if URL is valid
            - Second element is error message if URL is invalid, None otherwise
    """
    try:
        # Input type validation
        if not isinstance(url, str):
            return False, "URL must be a string"

        # Basic length validation
        if not MIN_URL_LENGTH <= len(url) <= MAX_URL_LENGTH:
            return (
                False,
                f"URL length must be between {MIN_URL_LENGTH} and {MAX_URL_LENGTH} characters",
            )

        # Normalize URL
        url = url.strip()

        # Parse URL - This might raise URLFormatError
        try:
            parsed = urlparse(url)
        except Exception as e:
            raise URLFormatError(f"Unable to parse URL: {str(e)}")

        # Scheme validation
        if not parsed.scheme:
            return False, "URL must include scheme (http/https)"
        if parsed.scheme.lower() not in ALLOWED_SCHEMES:
            return False, "URL must use HTTP or HTTPS protocol"

        # Domain validation
        if not parsed.netloc:
            return False, "URL must include a valid domain"

        domain = parsed.netloc.lower()

        # Remove port if present
        if ":" in domain:
            domain = domain.split(":")[0]

        # Security Checks - These raise URLSecurityError
        # 1. Check for blocked domains
        if any(blocked in domain for blocked in BLOCKED_DOMAINS):
            raise URLSecurityError("Domain not allowed")

        # 2. Check TLD
        tld = domain.split(".")[-1] if "." in domain else ""
        if tld in BLOCKED_TLDS:
            raise URLSecurityError("Invalid top-level domain")

        # 3. IP address validation
        if re.match(r"^\d+\.\d+\.\d+\.\d+$", domain):
            if is_private_ip(domain):
                raise URLSecurityError("Private IP addresses not allowed")

        # 4. Check for credentials in URL
        if parsed.username or parsed.password:
            raise URLSecurityError("URLs containing credentials are not allowed")

        # 5. Check for suspicious patterns
        for pattern in SECURITY_PATTERNS:
            if pattern in url.lower():
                raise URLSecurityError(f"URL contains suspicious pattern: {pattern}")

        # 6. Validate characters (only printable ASCII)
        if not re.match(r"^[\x21-\x7E]+$", url):
            raise URLSecurityError("URL contains invalid characters")

        return True, None

    except URLSecurityError as e:
        # Log security violations with high severity
        logger.warning(
            "Security violation in URL validation",
            extra={"url": url, "error": str(e), "security_violation": True},
        )
        return False, f"Security violation: {str(e)}"

    except URLFormatError as e:
        # Log format errors with lower severity
        logger.info("URL format error", extra={"url": url, "error": str(e)})
        return False, f"Invalid URL format: {str(e)}"

    except Exception as e:
        # Log unexpected errors
        logger.error(
            "Unexpected error in URL validation",
            exc_info=True,
            extra={"url": url, "error": str(e)},
        )
        return False, "Invalid URL format"


def validate_expiry_days(days: Any) -> Tuple[bool, Optional[str]]:
    """
    Validate and normalize expiration days input.

    Args:
        days: Raw input value for expiration days. Can be string, int, or float.
            Will be converted to int if possible.

    Returns:
        Tuple[bool, Optional[str]]: Tuple containing:
            - bool: True if validation succeeds, False otherwise
            - Optional[str]: Error message if validation fails, None if succeeds

    Examples:
        >>> validate_expiry_days(7)
        (True, None)
        >>> validate_expiry_days("10")
        (True, None)
        >>> validate_expiry_days(-1)
        (False, "Expiration must be between 1 and 365 days")
        >>> validate_expiry_days("abc")
        (False, "Invalid expiration days format")
    """
    try:
        # Input type validation
        if days is None:
            logger.info("Received None value for expiry days")
            return False, "Expiration days cannot be None"

        # Convert to float first to handle both int and float inputs
        try:
            days_float = float(days)
        except (ValueError, TypeError) as e:
            logger.info(f"Invalid expiry days format: {days}", exc_info=True)
            return False, "Invalid expiration days format"

        # Convert to int and check for decimal values
        days_int = int(days_float)
        if days_float != days_int:
            logger.info(f"Received decimal value for expiry days: {days}")
            return False, "Expiration days must be a whole number"

        # Range validation
        if not (MIN_EXPIRY_DAYS <= days_int <= MAX_EXPIRY_DAYS):
            logger.info(
                f"Expiry days {days_int} outside allowed range "
                f"({MIN_EXPIRY_DAYS}-{MAX_EXPIRY_DAYS})"
            )
            return False, (
                f"Expiration must be between {MIN_EXPIRY_DAYS} "
                f"and {MAX_EXPIRY_DAYS} days"
            )

        return True, None

    except ValueError:
        logger.error(
            "ValueError while validating expiry days",
            extra={"days": days},
            exc_info=True,
        )
        return False, "Invalid expiration days format"
    except TypeError:
        logger.error(
            "TypeError while validating expiry days",
            extra={"days": days},
            exc_info=True,
        )
        return False, "Invalid expiration days type"
    except Exception as e:
        logger.error(
            "Unexpected error validating expiry days",
            extra={"days": days},
            exc_info=True,
        )
        return False, f"Unexpected error: {str(e)}"


def normalize_expiry_days(days: Any) -> int:
    """
    Normalize and validate expiry days, returning default if invalid.

    Args:
        days: Raw input value for expiration days

    Returns:
        int: Normalized days value or default value if invalid

    Examples:
        >>> normalize_expiry_days(7)
        7
        >>> normalize_expiry_days("invalid")
        7  # Returns DEFAULT_EXPIRY_DAYS
    """
    is_valid, error = validate_expiry_days(days)
    if not is_valid:
        logger.info(
            f"Using default expiry days ({DEFAULT_EXPIRY_DAYS}) "
            f"due to validation error: {error}"
        )
        return DEFAULT_EXPIRY_DAYS
    try:
        return int(days)
    except ValueError:
        logger.info(f"Failed to convert {days} to int, using default value")
        return DEFAULT_EXPIRY_DAYS
