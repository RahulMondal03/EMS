"""Insertion sort implementation.

Insertion sort grows a sorted prefix one item at a time. For each new item it
walks back through the already sorted prefix, shifting larger items right, and
drops the item into the gap that opens up. Runs in O(n^2) comparisons in the
worst case and O(n) on already sorted input, since each item then stops at the
first comparison.
"""


def insertion_sort(items):
    """Return a new list with the items of ``items`` in ascending order.

    Args:
        items: An iterable of mutually comparable values.

    Returns:
        A new sorted list. The input is left untouched.
    """
    result = list(items)

    for i in range(1, len(result)):
        current = result[i]
        j = i - 1
        # Shift every item greater than current one slot to the right.
        while j >= 0 and result[j] > current:
            result[j + 1] = result[j]
            j -= 1
        result[j + 1] = current

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
        print(f"{sample} -> {insertion_sort(sample)}")
