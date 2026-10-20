"""Unit tests for divide."""

import unittest
from decimal import Decimal
from fractions import Fraction

from divide import divide


class DivideTest(unittest.TestCase):
    def test_exact_division(self):
        self.assertEqual(divide(10, 2), 5)

    def test_true_division_returns_fraction_part(self):
        self.assertEqual(divide(7, 2), 3.5)

    def test_negative_numbers(self):
        self.assertEqual(divide(-9, 3), -3)
        self.assertEqual(divide(9, -3), -3)
        self.assertEqual(divide(-9, -3), 3)

    def test_zero_dividend(self):
        self.assertEqual(divide(0, 5), 0)

    def test_floats(self):
        self.assertAlmostEqual(divide(1.5, 0.5), 3.0)
        self.assertAlmostEqual(divide(1, 3), 0.3333333333333333)

    def test_other_number_types(self):
        self.assertEqual(divide(Fraction(1, 2), Fraction(1, 4)), 2)
        self.assertEqual(divide(Decimal("1.5"), Decimal("0.5")), Decimal("3"))

    def test_zero_divisor_raises_value_error(self):
        for zero in [0, 0.0, -0.0, Fraction(0), Decimal(0)]:
            with self.subTest(zero=zero):
                with self.assertRaisesRegex(ValueError, "cannot divide by zero"):
                    divide(10, zero)

    def test_rejects_non_number_arguments(self):
        for bad in ["10", None, [10], True, False]:
            with self.subTest(bad=bad):
                with self.assertRaises(TypeError):
                    divide(bad, 2)
                with self.assertRaises(TypeError):
                    divide(10, bad)

    def test_error_names_argument_and_value(self):
        with self.assertRaisesRegex(TypeError, r"b must be a number, got None"):
            divide(10, None)


if __name__ == "__main__":
    unittest.main()
