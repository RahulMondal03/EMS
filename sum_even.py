"""Sum of the even numbers in a list.

A number is even when dividing it by 2 leaves no remainder. Python's ``%``
operator returns a non-negative remainder for a positive divisor, so negative
even numbers such as -4 are handled correctly too.
"""


def sum_even(numbers):
    """Return the sum of the even numbers in ``numbers``.

    Args:
        numbers: An iterable of numbers.

    Returns:
        The sum of every item that is evenly divisible by 2, or 0 when there
        are none.
    """
    return sum(n for n in numbers if n % 2 == 0)


if __name__ == "__main__":
    samples = [
        [1, 2, 3, 4, 5, 6],
        [1, 3, 5],
        [-4, -3, 0, 7, 10],
        [42],
        [],
    ]

    for sample in samples:
        print(f"{sample} -> {sum_even(sample)}")
