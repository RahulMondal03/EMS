"""Input validation for lists that must contain only integers.

The entry points are:

    validate_int_list(values)   -> list[int], raises on any bad element
    partition_int_list(values)  -> (ints, problems), never raises
    parse_int_list(text)        -> list[int], for raw user input like "1, 2, 3"

All three report *every* offending element, not just the first one, so a
caller can show the user one complete error message instead of making them
fix the list one entry at a time.
"""

from __future__ import annotations

from typing import Iterable, List, NamedTuple, Sequence, Tuple

__all__ = [
    "Problem",
    "ListValidationError",
    "validate_int_list",
    "partition_int_list",
    "parse_int_list",
]


class Problem(NamedTuple):
    """One element that failed validation."""

    index: int
    value: object
    reason: str

    def __str__(self) -> str:
        return f"index {self.index}: {self.value!r} ({self.reason})"


class ListValidationError(ValueError):
    """Raised when a list contains one or more non-integer values."""

    def __init__(self, problems: Sequence[Problem]) -> None:
        self.problems: Tuple[Problem, ...] = tuple(problems)
        count = len(self.problems)
        noun = "value" if count == 1 else "values"
        detail = "; ".join(str(p) for p in self.problems)
        super().__init__(f"{count} non-integer {noun} — {detail}")


def _check(
    index: int,
    value: object,
    *,
    allow_bool: bool,
    allow_integral_floats: bool,
    allow_numeric_strings: bool,
) -> Tuple[int, None] | Tuple[None, Problem]:
    """Validate one element. Returns (int, None) or (None, Problem)."""
    # bool is a subclass of int, so it has to be judged before the int check.
    if isinstance(value, bool):
        if allow_bool:
            return int(value), None
        return None, Problem(index, value, "boolean, not an integer")

    if isinstance(value, int):
        return value, None

    if isinstance(value, float):
        if not allow_integral_floats:
            return None, Problem(index, value, "float, not an integer")
        if value != value or value in (float("inf"), float("-inf")):
            return None, Problem(index, value, "not a finite number")
        if not value.is_integer():
            return None, Problem(index, value, "float with a fractional part")
        return int(value), None

    if isinstance(value, str):
        if not allow_numeric_strings:
            return None, Problem(index, value, "string, not an integer")
        text = value.strip()
        if not text:
            return None, Problem(index, value, "blank")
        try:
            return int(text, 10), None
        except ValueError:
            return None, Problem(index, value, "not a whole number")

    return None, Problem(index, value, f"{type(value).__name__}, not an integer")


def partition_int_list(
    values: Iterable[object],
    *,
    allow_bool: bool = False,
    allow_integral_floats: bool = False,
    allow_numeric_strings: bool = False,
) -> Tuple[List[int], List[Problem]]:
    """Split an iterable into the integers it holds and the problems found.

    Never raises for bad elements — use this when the caller wants to keep
    the good values and report the rest. A non-iterable (or a bare string,
    which is almost always a mistake here) still raises TypeError.
    """
    if isinstance(values, (str, bytes)):
        raise TypeError(
            f"expected a list of values, got {type(values).__name__}; "
            "use parse_int_list() for raw text input"
        )
    try:
        items = list(values)
    except TypeError as exc:
        raise TypeError(
            f"expected an iterable of values, got {type(values).__name__}"
        ) from exc

    ints: List[int] = []
    problems: List[Problem] = []
    for index, value in enumerate(items):
        number, problem = _check(
            index,
            value,
            allow_bool=allow_bool,
            allow_integral_floats=allow_integral_floats,
            allow_numeric_strings=allow_numeric_strings,
        )
        if problem is None:
            ints.append(number)          # type: ignore[arg-type]
        else:
            problems.append(problem)
    return ints, problems


def validate_int_list(
    values: Iterable[object],
    *,
    allow_bool: bool = False,
    allow_integral_floats: bool = False,
    allow_numeric_strings: bool = False,
    allow_empty: bool = True,
) -> List[int]:
    """Return the list as ``list[int]``, or raise ListValidationError.

    Options widen what counts as acceptable input:
      allow_bool             — treat True/False as 1/0 instead of rejecting them
      allow_integral_floats  — accept 4.0 (but never 4.5, nan or inf)
      allow_numeric_strings  — accept "4" and " -7 " (but never "4.5" or "")
    """
    ints, problems = partition_int_list(
        values,
        allow_bool=allow_bool,
        allow_integral_floats=allow_integral_floats,
        allow_numeric_strings=allow_numeric_strings,
    )
    if problems:
        raise ListValidationError(problems)
    if not ints and not allow_empty:
        raise ValueError("the list is empty")
    return ints


def parse_int_list(
    text: str,
    *,
    separator: str = ",",
    allow_empty: bool = True,
) -> List[int]:
    """Parse raw user input such as ``"1, 2, 3"`` into ``list[int]``.

    Splits on ``separator`` (whitespace when ``separator`` is None), then
    validates every field, so ``"1, two, 3.5"`` reports both bad fields at
    once. Empty fields between separators are reported, not silently dropped.
    """
    if not isinstance(text, str):
        raise TypeError(f"expected a string, got {type(text).__name__}")

    stripped = text.strip()
    if not stripped:
        if allow_empty:
            return []
        raise ValueError("no values given")

    fields = stripped.split(separator) if separator else stripped.split()
    return validate_int_list(
        fields,
        allow_numeric_strings=True,
        allow_empty=allow_empty,
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Validate the command-line arguments as a list of integers."""
    import sys

    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print("usage: int_list_validation.py VALUE [VALUE ...]")
        print('   or: int_list_validation.py "1, 2, 3"')
        return 2

    fields = args[0].split(",") if len(args) == 1 and "," in args[0] else args
    try:
        numbers = validate_int_list(fields, allow_numeric_strings=True)
    except ListValidationError as exc:
        print(f"Invalid list ({len(exc.problems)} bad entries):")
        for problem in exc.problems:
            print(f"  - {problem}")
        return 1
    print(f"OK: {numbers} (sum={sum(numbers)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
