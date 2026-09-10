"""Bubble sort implementation.

Bubble sort repeatedly steps through the list, comparing adjacent items and
swapping them when they are out of order. Each pass pushes the largest
remaining item to its final position, so the sorted tail grows by one on every
pass. Runs in O(n^2) comparisons in the worst case and O(n) on already sorted
input thanks to the early exit below.
"""


def bubble_sort(items):
    """Return a new list with the items of ``items`` in ascending order.

    Args:
        items: An iterable of mutually comparable values.

    Returns:
        A new sorted list. The input is left untouched.
    """
    result = list(items)
    n = len(result)

    for i in range(n - 1):
        swapped = False
        # The last i items are already in their final position.
        for j in range(n - 1 - i):
            if result[j] > result[j + 1]:
                result[j], result[j + 1] = result[j + 1], result[j]
                swapped = True
        if not swapped:
            # No swaps in a full pass means the list is already sorted.
            break

    return result


if __name__ == "__main__":
    samples = [
        [5, 1, 4, 2, 8],
        [1, 2, 3, 4, 5],
        [3, 3, 1, 2, 1],
        [42],
        [],
        ["pear", "apple", "fig"],
    ]

    for sample in samples:
        print(f"{sample} -> {bubble_sort(sample)}")
