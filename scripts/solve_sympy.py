import base64
import json
import re
import sys

import sympy
from sympy import (
    Eq,
    Matrix,
    Symbol,
    diff,
    integrate,
    latex,
    limit,
    nroots,
    simplify,
    solve as sympy_solve,
    solveset,
)
from sympy import FiniteSet
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)


TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)

COMMON_LOCAL_DICT = {
    "pi": sympy.pi,
    "e": sympy.E,
    "sqrt": sympy.sqrt,
    "sin": sympy.sin,
    "cos": sympy.cos,
    "tan": sympy.tan,
    "log": sympy.log,
    "ln": sympy.log,
    "exp": sympy.exp,
    "Abs": sympy.Abs,
}


def step(equation, index):
    return {"id": f"step-{index}", "equation": equation}


def matching_brace(text, start):
    depth = 0
    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return index
    return -1


def replace_command_with_one_arg(text, command, replacement):
    marker = f"\\{command}"
    while marker + "{" in text:
        start = text.index(marker + "{")
        arg_start = start + len(marker)
        arg_end = matching_brace(text, arg_start)
        if arg_end == -1:
            break
        inner = latex_to_sympy_text(text[arg_start + 1 : arg_end])
        text = text[:start] + f"{replacement}({inner})" + text[arg_end + 1 :]
    return text


def replace_frac(text):
    while "\\frac{" in text:
        start = text.index("\\frac{")
        numerator_start = start + len("\\frac")
        numerator_end = matching_brace(text, numerator_start)
        if numerator_end == -1 or numerator_end + 1 >= len(text) or text[numerator_end + 1] != "{":
            break
        denominator_start = numerator_end + 1
        denominator_end = matching_brace(text, denominator_start)
        if denominator_end == -1:
            break

        numerator = latex_to_sympy_text(text[numerator_start + 1 : numerator_end])
        denominator = latex_to_sympy_text(text[denominator_start + 1 : denominator_end])
        text = text[:start] + f"(({numerator})/({denominator}))" + text[denominator_end + 1 :]
    return text


def latex_to_sympy_text(text):
    text = text.strip()
    text = (
        text.replace("\\left", "")
        .replace("\\right", "")
        .replace("\\,", "")
        .replace("\\cdot", "*")
        .replace("\\times", "*")
        .replace("\\div", "/")
        .replace("\\pi", "pi")
        .replace("\\infty", "oo")
    )
    text = replace_frac(text)
    for command, replacement in [
        ("sqrt", "sqrt"),
        ("sin", "sin"),
        ("cos", "cos"),
        ("tan", "tan"),
        ("log", "log"),
        ("ln", "log"),
        ("exp", "exp"),
        ("abs", "Abs"),
    ]:
        text = replace_command_with_one_arg(text, command, replacement)
    text = re.sub(r"\\(sin|cos|tan|log|ln|exp)", lambda m: "log" if m.group(1) == "ln" else m.group(1), text)
    text = re.sub(r"([A-Za-z0-9_\)\.]+)\^\{([^{}]+)\}", r"\1**(\2)", text)
    text = re.sub(r"([A-Za-z0-9_\)\.]+)\^(-?\d+)", r"\1**(\2)", text)
    text = text.replace("{", "(").replace("}", ")")
    return text


def parse_math(text, extra_symbols=None):
    local_dict = dict(COMMON_LOCAL_DICT)
    for name in re.findall(r"\b[a-zA-Z]\b", text):
        local_dict.setdefault(name, Symbol(name))
    if extra_symbols:
        local_dict.update(extra_symbols)
    return parse_expr(
        latex_to_sympy_text(text),
        local_dict=local_dict,
        transformations=TRANSFORMATIONS,
        evaluate=True,
    )


def compact_problem(problem):
    return re.sub(r"\s+", "", problem).replace("\\left", "").replace("\\right", "").replace("\\,", "")


def extract_integral(problem):
    compact = compact_problem(problem)
    match = re.match(r"^\\int(?:_\{?([^{}^]+)\}?)?(?:\^\{?([^{}]+)\}?)?(.+)d([a-zA-Z])$", compact)
    if not match:
        return None
    return match.groups()


def solve_integral(problem):
    parsed = extract_integral(problem)
    if not parsed:
        return None

    lower, upper, expression_latex, variable_name = parsed
    variable = Symbol(variable_name)
    expression = parse_math(expression_latex, {variable_name: variable})
    antiderivative = simplify(integrate(expression, variable))

    if lower is not None and upper is not None:
        lower_expr = parse_math(lower)
        upper_expr = parse_math(upper)
        result = simplify(integrate(expression, (variable, lower_expr, upper_expr)))
        return {
            "steps": [
                step(problem, 1),
                step(f"\\left[{latex(antiderivative)}\\right]_{{{lower}}}^{{{upper}}}", 2),
                step(latex(result), 3),
            ],
            "finalAnswer": latex(result),
            "source": "sympy",
        }

    return {
        "steps": [
            step(problem, 1),
            step(f"\\int {latex(expression)}\\,d{variable_name}", 2),
            step(f"{latex(antiderivative)}+C", 3),
        ],
        "finalAnswer": f"{latex(antiderivative)}+C",
        "source": "sympy",
    }


def extract_derivative(problem):
    compact = compact_problem(problem)
    match = re.match(r"^\\frac\{d\}\{d([a-zA-Z])\}(.+)$", compact)
    if match:
        return match.group(2), match.group(1)

    match = re.match(r"^d/d([a-zA-Z])(.+)$", compact)
    if match:
        return match.group(2), match.group(1)

    for keyword in ("derivative", "derivati", "derive", "diff"):
        if compact.lower().startswith(keyword):
            expression = compact[len(keyword) :]
            variable_match = re.search(r"d([a-zA-Z])$", expression)
            if variable_match:
                return expression[: variable_match.start()], variable_match.group(1)
            return expression, "x"

    return None


def solve_derivative(problem):
    parsed = extract_derivative(problem)
    if not parsed:
        return None

    expression_text, variable_name = parsed
    variable = Symbol(variable_name)
    expression = parse_math(expression_text, {variable_name: variable})
    result = simplify(diff(expression, variable))
    return {
        "steps": [
            step(problem, 1),
            step(f"\\frac{{d}}{{d{variable_name}}}\\left({latex(expression)}\\right)", 2),
            step(latex(result), 3),
        ],
        "finalAnswer": latex(result),
        "source": "sympy",
    }


def extract_limit(problem):
    compact = compact_problem(problem)
    match = re.match(r"^\\lim_\{?([a-zA-Z])\\to([^{}]+)\}?(.+)$", compact)
    if match:
        return match.group(3), match.group(1), match.group(2)
    return None


def solve_limit(problem):
    parsed = extract_limit(problem)
    if not parsed:
        return None

    expression_text, variable_name, point_text = parsed
    variable = Symbol(variable_name)
    expression = parse_math(expression_text, {variable_name: variable})
    point = parse_math(point_text)
    result = simplify(limit(expression, variable, point))
    return {
        "steps": [
            step(problem, 1),
            step(f"\\lim_{{{variable_name}\\to {latex(point)}}}{latex(expression)}", 2),
            step(latex(result), 3),
        ],
        "finalAnswer": latex(result),
        "source": "sympy",
    }


def solve_equation(problem):
    if "=" not in problem:
        return None

    parts = [part.strip() for part in problem.split("=")]
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None

    left = parse_math(parts[0])
    right = parse_math(parts[1])
    symbols = sorted((left.free_symbols | right.free_symbols), key=lambda s: s.name)
    variable = symbols[0] if symbols else Symbol("x")
    equation = Eq(left, right)
    solutions = sympy_solve(equation, variable)
    if not solutions:
        solution_set = solveset(equation, variable)
        final_answer = latex(solution_set)
    else:
        final_answer = ",\\ ".join(f"{latex(variable)}={latex(solution)}" for solution in solutions)

    return {
        "steps": [
            step(problem, 1),
            step(f"{latex(left)}={latex(right)}", 2),
            step(final_answer, 3),
        ],
        "finalAnswer": final_answer,
        "source": "sympy",
    }


def split_system(problem):
    normalized = problem.strip()
    normalized = normalized.replace("\\begin{cases}", "").replace("\\end{cases}", "")
    normalized = normalized.replace("\\\\", ";")
    if ";" not in normalized:
        return None
    equations = [part.strip() for part in normalized.split(";") if part.strip()]
    return equations if len(equations) > 1 and all("=" in equation for equation in equations) else None


def solve_system(problem):
    equations = split_system(problem)
    if not equations:
        return None

    parsed_equations = []
    symbols = set()
    for equation in equations:
        left_text, right_text = [part.strip() for part in equation.split("=", 1)]
        left = parse_math(left_text)
        right = parse_math(right_text)
        parsed_equations.append(Eq(left, right))
        symbols |= left.free_symbols | right.free_symbols

    variables = sorted(symbols, key=lambda s: s.name)
    result = sympy_solve(parsed_equations, variables, dict=True)
    if result:
        final_answer = ";\\ ".join(
            ",\\ ".join(f"{latex(variable)}={latex(solution[variable])}" for variable in variables if variable in solution)
            for solution in result
        )
    else:
        final_answer = "\\varnothing"

    return {
        "steps": [
            step(problem, 1),
            step("\\begin{cases}" + "\\\\".join(latex(eq) for eq in parsed_equations) + "\\end{cases}", 2),
            step(final_answer, 3),
        ],
        "finalAnswer": final_answer,
        "source": "sympy",
    }


def solve_matrix(problem):
    compact = compact_problem(problem)
    match = re.match(r"^(det|determinant|inverse|inv)\((.+)\)$", compact, re.IGNORECASE)
    if not match:
        return None

    operation = match.group(1).lower()
    raw_rows = match.group(2).strip("[]")
    rows = []
    for row in raw_rows.split(";"):
        values = [parse_math(value) for value in row.strip("[]").split(",") if value]
        rows.append(values)
    matrix = Matrix(rows)
    result = simplify(matrix.det()) if operation in ("det", "determinant") else matrix.inv()
    final_answer = latex(result)

    return {
        "steps": [
            step(problem, 1),
            step(latex(matrix), 2),
            step(final_answer, 3),
        ],
        "finalAnswer": final_answer,
        "source": "sympy",
    }


def solve_statistics(problem):
    compact = compact_problem(problem)
    match = re.match(r"^(mean|average|mesatare|median|mode|moda|std|stdev)\((.+)\)$", compact, re.IGNORECASE)
    if not match:
        return None

    operation = match.group(1).lower()
    values = [parse_math(value) for value in match.group(2).split(",") if value]
    if not values:
        return None

    if operation in ("mean", "average", "mesatare"):
        result = simplify(sum(values) / len(values))
        label = "\\text{mesatarja}"
    elif operation == "median":
        ordered = sorted(values, key=lambda value: float(value.evalf()))
        middle = len(ordered) // 2
        result = ordered[middle] if len(ordered) % 2 else simplify((ordered[middle - 1] + ordered[middle]) / 2)
        label = "\\text{mediana}"
    elif operation in ("mode", "moda"):
        counts = {value: values.count(value) for value in values}
        max_count = max(counts.values())
        modes = [value for value, count in counts.items() if count == max_count]
        result = modes[0] if len(modes) == 1 else FiniteSet(*modes)
        label = "\\text{moda}"
    else:
        mean = simplify(sum(values) / len(values))
        variance = simplify(sum((value - mean) ** 2 for value in values) / len(values))
        result = simplify(variance ** sympy.Rational(1, 2))
        label = "\\text{devijimi standard}"

    final_answer = latex(result)
    return {
        "steps": [
            step(problem, 1),
            step(f"{label}\\left({','.join(latex(value) for value in values)}\\right)", 2),
            step(final_answer, 3),
        ],
        "finalAnswer": final_answer,
        "source": "sympy",
    }


def solve_expression(problem):
    expression = parse_math(problem)
    simplified = simplify(expression)
    final = latex(simplified)
    steps = [step(problem, 1)]
    if latex(expression) != final:
        steps.append(step(latex(expression), 2))
        steps.append(step(final, 3))
    else:
        steps.append(step(final, 2))

    return {
        "steps": steps,
        "finalAnswer": final,
        "source": "sympy",
    }


def solve(problem):
    problem = problem.strip()
    solvers = [
        solve_system,
        solve_integral,
        solve_derivative,
        solve_limit,
        solve_matrix,
        solve_statistics,
        solve_equation,
        solve_expression,
    ]

    for solver in solvers:
        try:
            result = solver(problem)
            if result:
                return result
        except Exception:
            continue

    raise ValueError("Ky problem nuk u mbulua nga solver-i lokal.")


if __name__ == "__main__":
    try:
        encoded = sys.argv[1]
        problem_text = base64.b64decode(encoded).decode("utf-8")
        print(json.dumps(solve(problem_text), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
