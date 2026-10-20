"""Division that fails clearly on bad input.

Plain ``a / b`` raises ``ZeroDivisionError`` when ``b`` is zero. This helper
checks for that case up front and raises a ``ValueError`` with a readable
message instead, and rejects arguments that are not numbers. Booleans are
rejected too: ``bool`` is a subclass of ``int`` in Python, but passing
``True``/``False`` as an operand is almost always a mistake.
"""

import numbers


def divide(a, b):
    """Return ``a`` divided by ``b``.

    Args:
        a: The dividend. Any number except a boolean.
        b: The divisor. Any non-zero number except a boolean.

    Returns:
        The result of ``a / b`` (true division, so ``divide(7, 2)`` is 3.5).

    Raises:
        TypeError: If ``a`` or ``b`` is not a number.
        ValueError: If ``b`` is zero.
    """
    for name, value in (("a", a), ("b", b)):
        if isinstance(value, bool) or not isinstance(value, numbers.Number):
            raise TypeError(
                f"{name} must be a number, got {value!r} ({type(value).__name__})"
            )

    if b == 0:
        raise ValueError("cannot divide by zero")

    return a / b


if __name__ == "__main__":
    samples = [
        (10, 2),
        (7, 2),
        (-9, 3),
        (1.5, 0.5),
        (10, 0),
        (10, 0.0),
        ("10", 2),
        (10, None),
        (True, 1),
    ]

    for a, b in samples:
        try:
            print(f"divide({a!r}, {b!r}) -> {divide(a, b)!r}")
        except (TypeError, ValueError) as error:
            print(f"divide({a!r}, {b!r}) -> {type(error).__name__}: {error}")
