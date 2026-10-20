"""Sum of the even numbers in a list.

A number is even when dividing it by 2 leaves no remainder. Python's ``%``
operator returns a non-negative remainder for a positive divisor, so negative
even numbers such as -4 are handled correctly too.

Only integers have a meaningful notion of evenness, so any other value in the
input (floats, strings, None, ...) is rejected with a ``TypeError``. Booleans
are rejected as well: ``bool`` is a subclass of ``int`` in Python, but
``True``/``False`` in a list of numbers is almost always a mistake.
"""


def sum_even(numbers):
    """Return the sum of the even integers in ``numbers``.

    Args:
        numbers: An iterable of integers.

    Returns:
        The sum of every item that is evenly divisible by 2, or 0 when there
        are none.

    Raises:
        TypeError: If ``numbers`` is not iterable, or if any item is not an
            integer.
    """
    try:
        items = list(numbers)
    except TypeError:
        raise TypeError(
            f"expected an iterable of integers, got {type(numbers).__name__}"
        ) from None

    for index, n in enumerate(items):
        if isinstance(n, bool) or not isinstance(n, int):
            raise TypeError(
                f"item at index {index} is not an integer: {n!r} "
                f"({type(n).__name__})"
            )

    return sum(n for n in items if n % 2 == 0)


if __name__ == "__main__":
    samples = [
        [1, 2, 3, 4, 5, 6],
        [1, 3, 5],
        [-4, -3, 0, 7, 10],
        [42],
        [],
        [2, 4.0, 6],
        [2, "4", 6],
        [2, None],
        [True, 2],
        42,
    ]

    for sample in samples:
        try:
            print(f"{sample!r} -> {sum_even(sample)}")
        except TypeError as error:
            print(f"{sample!r} -> TypeError: {error}")
