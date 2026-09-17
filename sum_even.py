"""Sum of the even numbers in a list.

Walks the list once, keeping only the values that divide evenly by two, and
adds them up. Odd numbers contribute nothing, so an empty list or a list with
no even numbers sums to 0. Runs in O(n) time and uses constant extra space.
"""


def sum_even(numbers):
    """Return the sum of the even numbers in ``numbers``.

    Args:
        numbers: An iterable of numbers.

    Returns:
        The sum of the even values, or 0 if there are none. The input is left
        untouched.
    """
    total = 0

    for number in numbers:
        if number % 2 == 0:
            total += number

    return total


if __name__ == "__main__":
    samples = [
        [1, 2, 3, 4, 5, 6],
        [1, 3, 5],
        [2, 4, 6],
        [-4, -3, 0, 7],
        [10],
        [],
    ]

    for sample in samples:
        print(f"{sample} -> {sum_even(sample)}")
