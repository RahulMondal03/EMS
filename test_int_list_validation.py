"""Tests for int_list_validation. Run: python3 -m unittest -v test_int_list_validation"""

import unittest

from int_list_validation import (
    ListValidationError,
    parse_int_list,
    partition_int_list,
    validate_int_list,
)


class ValidateIntList(unittest.TestCase):
    def test_accepts_a_list_of_ints(self):
        self.assertEqual(validate_int_list([1, 2, 3]), [1, 2, 3])

    def test_accepts_negatives_and_zero(self):
        self.assertEqual(validate_int_list([-7, 0, 7]), [-7, 0, 7])

    def test_accepts_any_iterable(self):
        self.assertEqual(validate_int_list((4, 5)), [4, 5])
        self.assertEqual(validate_int_list(range(3)), [0, 1, 2])

    def test_empty_list_is_allowed_by_default(self):
        self.assertEqual(validate_int_list([]), [])

    def test_empty_list_can_be_rejected(self):
        with self.assertRaises(ValueError):
            validate_int_list([], allow_empty=False)

    def test_rejects_float(self):
        with self.assertRaises(ListValidationError) as ctx:
            validate_int_list([1, 2.5, 3])
        self.assertEqual([p.index for p in ctx.exception.problems], [1])
        self.assertIn("float", ctx.exception.problems[0].reason)

    def test_rejects_string(self):
        with self.assertRaises(ListValidationError) as ctx:
            validate_int_list([1, "2", 3])
        self.assertIn("string", ctx.exception.problems[0].reason)

    def test_rejects_none_and_containers(self):
        with self.assertRaises(ListValidationError) as ctx:
            validate_int_list([None, [1], {"a": 1}])
        reasons = [p.reason for p in ctx.exception.problems]
        self.assertEqual(len(reasons), 3)
        self.assertIn("NoneType", reasons[0])
        self.assertIn("list", reasons[1])
        self.assertIn("dict", reasons[2])

    def test_rejects_bool_because_it_is_not_really_an_integer(self):
        with self.assertRaises(ListValidationError) as ctx:
            validate_int_list([1, True])
        self.assertIn("boolean", ctx.exception.problems[0].reason)

    def test_reports_every_bad_value_at_once(self):
        with self.assertRaises(ListValidationError) as ctx:
            validate_int_list(["a", 1, 2.5, None, 4])
        self.assertEqual([p.index for p in ctx.exception.problems], [0, 2, 3])
        self.assertIn("3 non-integer values", str(ctx.exception))

    def test_message_is_singular_for_one_bad_value(self):
        with self.assertRaises(ListValidationError) as ctx:
            validate_int_list([1, 2.5])
        self.assertIn("1 non-integer value —", str(ctx.exception))

    def test_a_bare_string_is_a_type_error_not_a_char_list(self):
        with self.assertRaises(TypeError):
            validate_int_list("123")

    def test_non_iterable_is_a_type_error(self):
        with self.assertRaises(TypeError):
            validate_int_list(42)


class OptionalCoercions(unittest.TestCase):
    def test_allow_bool(self):
        self.assertEqual(validate_int_list([True, False], allow_bool=True), [1, 0])

    def test_allow_integral_floats(self):
        self.assertEqual(validate_int_list([4.0, -2.0], allow_integral_floats=True), [4, -2])

    def test_allow_integral_floats_still_rejects_fractions(self):
        with self.assertRaises(ListValidationError) as ctx:
            validate_int_list([4.5], allow_integral_floats=True)
        self.assertIn("fractional", ctx.exception.problems[0].reason)

    def test_allow_integral_floats_rejects_nan_and_inf(self):
        with self.assertRaises(ListValidationError) as ctx:
            validate_int_list([float("nan"), float("inf")], allow_integral_floats=True)
        self.assertEqual(len(ctx.exception.problems), 2)
        for problem in ctx.exception.problems:
            self.assertIn("finite", problem.reason)

    def test_allow_numeric_strings(self):
        self.assertEqual(
            validate_int_list(["4", " -7 "], allow_numeric_strings=True), [4, -7]
        )

    def test_allow_numeric_strings_rejects_decimals_and_blanks(self):
        with self.assertRaises(ListValidationError) as ctx:
            validate_int_list(["4.5", "", "  ", "0x10"], allow_numeric_strings=True)
        self.assertEqual(len(ctx.exception.problems), 4)


class PartitionIntList(unittest.TestCase):
    def test_keeps_good_values_and_reports_bad_ones(self):
        ints, problems = partition_int_list([1, "x", 2, 3.5])
        self.assertEqual(ints, [1, 2])
        self.assertEqual([p.index for p in problems], [1, 3])

    def test_never_raises_for_bad_elements(self):
        ints, problems = partition_int_list([None, object()])
        self.assertEqual(ints, [])
        self.assertEqual(len(problems), 2)

    def test_indexes_refer_to_the_original_positions(self):
        _, problems = partition_int_list([1, 2, 3, "bad"])
        self.assertEqual(problems[0].index, 3)


class ParseIntList(unittest.TestCase):
    def test_parses_a_comma_separated_string(self):
        self.assertEqual(parse_int_list("1, 2, 3"), [1, 2, 3])

    def test_parses_negatives(self):
        self.assertEqual(parse_int_list("-1,0,1"), [-1, 0, 1])

    def test_blank_input_is_empty_by_default(self):
        self.assertEqual(parse_int_list("   "), [])

    def test_blank_input_can_be_rejected(self):
        with self.assertRaises(ValueError):
            parse_int_list("", allow_empty=False)

    def test_reports_all_bad_fields(self):
        with self.assertRaises(ListValidationError) as ctx:
            parse_int_list("1, two, 3.5, 4")
        self.assertEqual([p.index for p in ctx.exception.problems], [1, 2])

    def test_does_not_silently_drop_empty_fields(self):
        with self.assertRaises(ListValidationError) as ctx:
            parse_int_list("1,,2")
        self.assertIn("blank", ctx.exception.problems[0].reason)

    def test_whitespace_separator(self):
        self.assertEqual(parse_int_list("1  2\t3", separator=None), [1, 2, 3])

    def test_non_string_input_is_a_type_error(self):
        with self.assertRaises(TypeError):
            parse_int_list([1, 2])


if __name__ == "__main__":
    unittest.main()
