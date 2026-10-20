"""Unit tests for sum_even."""

import unittest

from sum_even import sum_even


class SumEvenTest(unittest.TestCase):
    def test_mixed_even_and_odd(self):
        self.assertEqual(sum_even([1, 2, 3, 4, 5, 6]), 12)

    def test_only_odd_returns_zero(self):
        self.assertEqual(sum_even([1, 3, 5]), 0)

    def test_empty_list_returns_zero(self):
        self.assertEqual(sum_even([]), 0)

    def test_single_even(self):
        self.assertEqual(sum_even([42]), 42)

    def test_negative_numbers_and_zero(self):
        self.assertEqual(sum_even([-4, -3, 0, 7, 10]), 6)

    def test_large_integers(self):
        big = 10**20
        self.assertEqual(sum_even([big, big + 1]), big)

    def test_accepts_any_iterable(self):
        self.assertEqual(sum_even((2, 3, 4)), 6)
        self.assertEqual(sum_even(range(1, 11)), 30)
        self.assertEqual(sum_even(n for n in [2, 4, 5]), 6)

    def test_does_not_modify_input(self):
        numbers = [1, 2, 3, 4]
        sum_even(numbers)
        self.assertEqual(numbers, [1, 2, 3, 4])

    def test_rejects_non_integer_items(self):
        for bad in [4.0, 2.5, "4", None, [2], True, False]:
            with self.subTest(bad=bad):
                with self.assertRaises(TypeError):
                    sum_even([2, bad, 6])

    def test_error_names_index_and_value(self):
        with self.assertRaisesRegex(TypeError, r"index 1 .*'4' \(str\)"):
            sum_even([2, "4", 6])

    def test_rejects_non_iterable_input(self):
        for bad in [42, None, 3.5]:
            with self.subTest(bad=bad):
                with self.assertRaisesRegex(TypeError, "expected an iterable"):
                    sum_even(bad)


if __name__ == "__main__":
    unittest.main()
